/**
 * User lookup and creation.
 *
 * GUARDRAILS.md section 4: identity comes only from a verified webhook update
 * or validated initData. Nothing here accepts a caller-supplied user id.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { households, householdMembers, users, type NewUser, type User } from '../schema.js';

export interface UpsertUserInput {
  telegramId: bigint;
  firstName?: string | null;
  username?: string | null;
  timezone: string;
}

export async function findByTelegramId(db: Database, telegramId: bigint): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return rows[0] ?? null;
}

export async function findById(db: Database, id: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Look the user up, creating them — and their personal space — on first
 * contact.
 *
 * Idempotent by construction: Telegram redelivers webhooks, so two concurrent
 * `/start` messages must not create two users, or two personal spaces for
 * one. `onConflictDoNothing` distinguishes a genuine first contact (a row
 * comes back) from a repeat one (it doesn't) — only the former gets a
 * personal space; the latter just refreshes the profile fields.
 */
export async function upsertByTelegramId(db: Database, input: UpsertUserInput): Promise<User> {
  const values: NewUser = {
    telegramId: input.telegramId,
    firstName: input.firstName ?? null,
    username: input.username ?? null,
    timezone: input.timezone,
  };

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values(values)
      .onConflictDoNothing({ target: users.telegramId })
      .returning();

    const freshUser = inserted[0];
    if (freshUser) {
      const [space] = await tx
        .insert(households)
        .values({ createdBy: freshUser.id, isPersonal: true })
        .returning();
      if (!space) throw new Error('Insert returned no personal space');

      await tx.insert(householdMembers).values({ householdId: space.id, userId: freshUser.id });

      const [user] = await tx
        .update(users)
        .set({ activeHouseholdId: space.id, updatedAt: new Date() })
        .where(eq(users.id, freshUser.id))
        .returning();
      if (!user) throw new Error('Update returned no user');
      return user;
    }

    const [user] = await tx
      .update(users)
      .set({ firstName: values.firstName, username: values.username, updatedAt: new Date() })
      .where(eq(users.telegramId, input.telegramId))
      .returning();
    if (!user) throw new Error('upsertByTelegramId returned no row');
    return user;
  });
}

/**
 * Users with digests switched on, for the hourly tick to check.
 *
 * Not filtered by hour here — each user's digest hour is compared against the
 * current time in THEIR OWN timezone (GUARDRAILS.md section 9), which only
 * resolves per-user in application code, not in a single SQL WHERE clause.
 */
export async function listDigestEligible(db: Database): Promise<User[]> {
  return db.select().from(users).where(eq(users.digestEnabled, true));
}

/** Users with proactive budget alerts switched on. */
export async function listAlertEligible(db: Database): Promise<User[]> {
  return db.select().from(users).where(eq(users.alertsEnabled, true));
}

export async function markOnboarded(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ onboardedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export interface UpdateSettingsInput {
  timezone?: string;
  digestHour?: number;
  digestEnabled?: boolean;
  nudgeEnabled?: boolean;
  alertsEnabled?: boolean;
}

export async function updateSettings(
  db: Database,
  userId: string,
  input: UpdateSettingsInput,
): Promise<User> {
  const rows = await db
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  const user = rows[0];
  if (!user) throw new Error(`No user ${userId}`);
  return user;
}
