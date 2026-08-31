/**
 * Budget threshold alerts.
 *
 * GUARDRAILS.md section 3: the unique index on (user_id, year, month,
 * threshold_pct) is what lets the hourly tick re-check every user's spend
 * ratio every single run without re-announcing a threshold it already sent —
 * the second attempt at the same threshold just conflicts and does nothing.
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { budgetAlerts } from '../schema.js';

/**
 * Reserve `thresholdPct` for this month, if it hasn't been already.
 *
 * Returns the new row's id when this call is the one that reserved it — the
 * caller should send the message, then either leave the reservation in place
 * on success or call `release` on failure so a later tick can retry. Returns
 * null when another call already holds this threshold this month.
 */
export async function recordIfNew(
  db: Database,
  userId: string,
  year: number,
  month: number,
  thresholdPct: number,
): Promise<string | null> {
  const rows = await db
    .insert(budgetAlerts)
    .values({ userId, year, month, thresholdPct })
    .onConflictDoNothing({
      target: [
        budgetAlerts.userId,
        budgetAlerts.year,
        budgetAlerts.month,
        budgetAlerts.thresholdPct,
      ],
    })
    .returning({ id: budgetAlerts.id });

  return rows[0]?.id ?? null;
}

/**
 * Undo a reservation from `recordIfNew` after the message failed to send.
 *
 * Without this, a Telegram delivery failure would permanently suppress that
 * threshold for the rest of the month — the record says "sent" even though
 * the user never received anything, and no later tick would retry it.
 */
export async function release(db: Database, id: string): Promise<void> {
  await db.delete(budgetAlerts).where(eq(budgetAlerts.id, id));
}

/** Every threshold already announced this month, for a single read instead of N. */
export async function sentThisMonth(
  db: Database,
  userId: string,
  year: number,
  month: number,
): Promise<Set<number>> {
  const rows = await db
    .select({ thresholdPct: budgetAlerts.thresholdPct })
    .from(budgetAlerts)
    .where(
      and(
        eq(budgetAlerts.userId, userId),
        eq(budgetAlerts.year, year),
        eq(budgetAlerts.month, month),
      ),
    );
  return new Set(rows.map((row) => row.thresholdPct));
}
