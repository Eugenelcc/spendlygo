/**
 * Households — "spaces" a user can act in: exactly one personal space
 * (created alongside the user, see `usersRepo.upsertByTelegramId`) plus any
 * number of shared ones joined by invite code. Membership (`household_members`)
 * and "which one is active right now" (`users.active_household_id`) are
 * deliberately separate — joining a new space, or switching into one you
 * already belong to, never removes you from any other.
 *
 * GUARDRAILS.md section 4: an invite code carries no other authority than
 * "join this household" — it is never treated as authentication. The caller
 * is always the verified `initData`/webhook identity; the code only decides
 * which household that identity joins.
 */

import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  households,
  householdInvites,
  householdMembers,
  users,
  type Household,
  type User,
} from '../schema.js';

const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I — easy to read aloud
const INVITE_CODE_LENGTH = 6;
const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000;

export type JoinFailureReason =
  | 'not_found'
  | 'expired'
  | 'already_used'
  | 'already_a_member'
  | 'own_invite'
  | 'not_a_member'
  | 'cannot_leave_personal';

export class JoinHouseholdError extends Error {
  constructor(readonly reason: JoinFailureReason) {
    super(`Cannot join: ${reason}`);
  }
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

export async function findById(db: Database, id: string): Promise<Household | null> {
  const rows = await db.select().from(households).where(eq(households.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function membersOf(db: Database, householdId: string): Promise<User[]> {
  const rows = await db
    .select({ user: users })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, householdId));
  return rows.map((row) => row.user);
}

/** Every space this user belongs to — their personal one first, then shared ones by join order. */
export async function mySpaces(db: Database, userId: string): Promise<Household[]> {
  const rows = await db
    .select({ household: households })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId))
    .orderBy(desc(households.isPersonal), asc(householdMembers.joinedAt));
  return rows.map((row) => row.household);
}

/** Every user has exactly one — created alongside them and never left or invited into. */
export async function personalSpaceOf(db: Database, userId: string): Promise<Household> {
  const rows = await db
    .select({ household: households })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(and(eq(householdMembers.userId, userId), eq(households.isPersonal, true)))
    .limit(1);
  const household = rows[0]?.household;
  if (!household) throw new Error(`User ${userId} has no personal space`);
  return household;
}

async function isMember(db: Database, householdId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Create a new shared space and move `creatorUserId` into it immediately —
 * they're presumably setting it up to use it right away. Starts with no
 * budget set (PRD F6.6: never fabricate one, and there is no single figure
 * to sensibly carry over from whichever space happened to be active before).
 */
export async function create(db: Database, creatorUserId: string): Promise<Household> {
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(households).values({ createdBy: creatorUserId }).returning();
    const household = inserted[0];
    if (!household) throw new Error('Insert returned no household');

    await tx.insert(householdMembers).values({ householdId: household.id, userId: creatorUserId });
    await tx
      .update(users)
      .set({ activeHouseholdId: household.id, updatedAt: new Date() })
      .where(eq(users.id, creatorUserId));

    return household;
  });
}

export interface CreateInviteResult {
  code: string;
  expiresAt: Date;
}

/** Generates a fresh code, retrying on the astronomically unlikely collision. */
export async function createInvite(
  db: Database,
  householdId: string,
  createdByUserId: string,
): Promise<CreateInviteResult> {
  if (!(await isMember(db, householdId, createdByUserId))) {
    throw new JoinHouseholdError('not_a_member');
  }

  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const rows = await db
      .insert(householdInvites)
      .values({ householdId, code, createdBy: createdByUserId, expiresAt })
      .onConflictDoNothing({ target: householdInvites.code })
      .returning({ code: householdInvites.code });

    if (rows.length > 0) return { code, expiresAt };
  }
  throw new Error('Could not generate a unique invite code after 5 attempts');
}

/**
 * Consume an invite code, adding `joiningUserId` to its household and
 * switching them into it — their other memberships are untouched.
 *
 * The whole check-and-consume sequence runs in one transaction, so two people
 * racing to use the same code cannot both succeed — the loser's UPDATE
 * affects zero rows and the transaction reports `already_used`.
 */
export async function joinByCode(
  db: Database,
  code: string,
  joiningUserId: string,
): Promise<Household> {
  return db.transaction(async (tx) => {
    const inviteRows = await tx
      .select()
      .from(householdInvites)
      .where(eq(householdInvites.code, code.toUpperCase()))
      .limit(1);
    const invite = inviteRows[0];
    if (!invite) throw new JoinHouseholdError('not_found');
    if (invite.createdBy === joiningUserId) throw new JoinHouseholdError('own_invite');
    if (invite.usedAt !== null) throw new JoinHouseholdError('already_used');
    if (invite.expiresAt.getTime() < Date.now()) throw new JoinHouseholdError('expired');

    const existingMembership = await tx
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, invite.householdId),
          eq(householdMembers.userId, joiningUserId),
        ),
      )
      .limit(1);
    if (existingMembership.length > 0) throw new JoinHouseholdError('already_a_member');

    // The WHERE clause here is the race guard: only the first transaction to
    // reach this finds usedAt still null and actually updates a row.
    const consumed = await tx
      .update(householdInvites)
      .set({ usedBy: joiningUserId, usedAt: new Date() })
      .where(and(eq(householdInvites.id, invite.id), isNull(householdInvites.usedAt)))
      .returning({ id: householdInvites.id });
    if (consumed.length === 0) throw new JoinHouseholdError('already_used');

    await tx
      .insert(householdMembers)
      .values({ householdId: invite.householdId, userId: joiningUserId });
    await tx
      .update(users)
      .set({ activeHouseholdId: invite.householdId, updatedAt: new Date() })
      .where(eq(users.id, joiningUserId));

    // Read back through the same transaction, not `findById` — the
    // transaction object (`tx`) is a distinct type from `Database`, and this
    // read must see the update above before it commits.
    const householdRows = await tx
      .select()
      .from(households)
      .where(eq(households.id, invite.householdId))
      .limit(1);
    const household = householdRows[0];
    if (!household) throw new Error('Household vanished mid-join');
    return household;
  });
}

/**
 * Leave a shared space — never the personal one, which isn't a membership
 * you can drop. If it was the active space, falls back to personal.
 */
export async function leave(db: Database, userId: string, householdId: string): Promise<void> {
  return db.transaction(async (tx) => {
    const household = (
      await tx.select().from(households).where(eq(households.id, householdId)).limit(1)
    )[0];
    if (!household) throw new JoinHouseholdError('not_a_member');
    if (household.isPersonal) throw new JoinHouseholdError('cannot_leave_personal');

    const deleted = await tx
      .delete(householdMembers)
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)),
      )
      .returning({ id: householdMembers.id });
    if (deleted.length === 0) throw new JoinHouseholdError('not_a_member');

    const user = (await tx.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    if (user?.activeHouseholdId === householdId) {
      const personal = (
        await tx
          .select({ household: households })
          .from(householdMembers)
          .innerJoin(households, eq(households.id, householdMembers.householdId))
          .where(and(eq(householdMembers.userId, userId), eq(households.isPersonal, true)))
          .limit(1)
      )[0]?.household;
      if (personal) {
        await tx
          .update(users)
          .set({ activeHouseholdId: personal.id, updatedAt: new Date() })
          .where(eq(users.id, userId));
      }
    }
  });
}

/** Switch which of the user's existing memberships is active. Never joins a new one. */
export async function switchActive(
  db: Database,
  userId: string,
  householdId: string,
): Promise<Household> {
  if (!(await isMember(db, householdId, userId))) {
    throw new JoinHouseholdError('not_a_member');
  }

  await db
    .update(users)
    .set({ activeHouseholdId: householdId, updatedAt: new Date() })
    .where(eq(users.id, userId));

  const household = await findById(db, householdId);
  if (!household) throw new Error(`Household ${householdId} vanished mid-switch`);
  return household;
}

export async function updateBudget(
  db: Database,
  householdId: string,
  monthlyBudgetCents: number | null,
): Promise<Household> {
  const rows = await db
    .update(households)
    .set({ monthlyBudgetCents, updatedAt: new Date() })
    .where(eq(households.id, householdId))
    .returning();
  const household = rows[0];
  if (!household) throw new Error(`No household ${householdId}`);
  return household;
}
