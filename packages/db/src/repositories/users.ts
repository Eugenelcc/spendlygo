/**
 * User lookup and creation.
 *
 * GUARDRAILS.md section 4: identity comes only from a verified webhook update
 * or validated initData. Nothing here accepts a caller-supplied user id.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { users, type NewUser, type User } from '../schema.js';

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
 * Look the user up, creating them on first contact.
 *
 * Idempotent by construction: Telegram redelivers webhooks, so two concurrent
 * `/start` messages must not create two users. The unique index on
 * `telegram_id` plus `onConflictDoUpdate` makes the race harmless.
 */
export async function upsertByTelegramId(db: Database, input: UpsertUserInput): Promise<User> {
  const values: NewUser = {
    telegramId: input.telegramId,
    firstName: input.firstName ?? null,
    username: input.username ?? null,
    timezone: input.timezone,
  };

  const rows = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        firstName: values.firstName,
        username: values.username,
        updatedAt: new Date(),
      },
    })
    .returning();

  const user = rows[0];
  if (!user) throw new Error('upsertByTelegramId returned no row');
  return user;
}

export async function markOnboarded(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ onboardedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export interface UpdateSettingsInput {
  timezone?: string;
  monthlyBudgetCents?: number | null;
  digestHour?: number;
  digestEnabled?: boolean;
  nudgeEnabled?: boolean;
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
