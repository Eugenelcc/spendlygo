/**
 * Households — a shared budget pool a user can join.
 *
 * GUARDRAILS.md section 4: an invite code carries no other authority than
 * "join this household" — it is never treated as authentication. The caller
 * is always the verified `initData`/webhook identity; the code only decides
 * which household that identity joins.
 */

import { randomInt } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../client.js';
import { households, householdInvites, users, type Household, type User } from '../schema.js';

const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I — easy to read aloud
const INVITE_CODE_LENGTH = 6;
const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000;

export type JoinFailureReason =
  'not_found' | 'expired' | 'already_used' | 'already_in_household' | 'own_invite';

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
  return db.select().from(users).where(eq(users.householdId, householdId));
}

/**
 * Create a household for `creatorUserId` and move them into it immediately.
 *
 * PRD-adjacent answer to "does existing data carry over": the creator's
 * current personal budget seeds the household's, so setting a budget and
 * then sharing it doesn't reset anything they already configured.
 */
export async function create(db: Database, creatorUserId: string): Promise<Household> {
  return db.transaction(async (tx) => {
    const creatorRows = await tx.select().from(users).where(eq(users.id, creatorUserId)).limit(1);
    const creator = creatorRows[0];
    if (!creator) throw new Error(`No user ${creatorUserId}`);
    if (creator.householdId !== null) {
      throw new JoinHouseholdError('already_in_household');
    }

    const inserted = await tx
      .insert(households)
      .values({ createdBy: creatorUserId, monthlyBudgetCents: creator.monthlyBudgetCents })
      .returning();
    const household = inserted[0];
    if (!household) throw new Error('Insert returned no household');

    await tx
      .update(users)
      .set({ householdId: household.id, updatedAt: new Date() })
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
 * Consume an invite code, moving `joiningUserId` into its household.
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
    const joinerRows = await tx.select().from(users).where(eq(users.id, joiningUserId)).limit(1);
    const joiner = joinerRows[0];
    if (!joiner) throw new Error(`No user ${joiningUserId}`);
    if (joiner.householdId !== null) throw new JoinHouseholdError('already_in_household');

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

    // The WHERE clause here is the race guard: only the first transaction to
    // reach this finds usedAt still null and actually updates a row.
    const consumed = await tx
      .update(householdInvites)
      .set({ usedBy: joiningUserId, usedAt: new Date() })
      .where(and(eq(householdInvites.id, invite.id), isNull(householdInvites.usedAt)))
      .returning({ id: householdInvites.id });
    if (consumed.length === 0) throw new JoinHouseholdError('already_used');

    await tx
      .update(users)
      .set({ householdId: invite.householdId, updatedAt: new Date() })
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

export async function leave(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ householdId: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
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
