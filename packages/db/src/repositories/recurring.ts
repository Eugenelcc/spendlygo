/**
 * Recurring rules and their materialisation ledger.
 *
 * GUARDRAILS.md section 3: `recurringRuns` is uniquely keyed on
 * (rule_id, occurrence_date). Insert-and-ignore-conflict on that key is what
 * makes an hourly tick that double-fires harmless — the second attempt finds
 * the row already there and does nothing.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { recurringRules, recurringRuns, transactions, type RecurringRule } from '../schema.js';

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Direction = 'in' | 'out';

export interface CreateRuleInput {
  userId: string;
  direction: Direction;
  amountCents: number;
  categoryId: string | null;
  note: string | null;
  cadence: Cadence;
  anchorDate: string;
  dayOfMonth: number | null;
  endDate: string | null;
}

export async function create(db: Database, input: CreateRuleInput): Promise<RecurringRule> {
  const rows = await db.insert(recurringRules).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('Insert returned no recurring rule');
  return row;
}

export async function listActiveForUser(db: Database, userId: string): Promise<RecurringRule[]> {
  return db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.userId, userId), eq(recurringRules.active, true)))
    .orderBy(desc(recurringRules.createdAt));
}

/** Every active rule for every user — what the hourly tick iterates. */
export async function listAllActive(db: Database): Promise<RecurringRule[]> {
  return db
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.active, true))
    .orderBy(asc(recurringRules.userId));
}

export async function deactivate(db: Database, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(recurringRules)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)))
    .returning({ id: recurringRules.id });
  return rows.length > 0;
}

export async function updateLastRunOn(
  db: Database,
  ruleId: string,
  lastRunOn: string,
): Promise<void> {
  await db
    .update(recurringRules)
    .set({ lastRunOn, updatedAt: new Date() })
    .where(eq(recurringRules.id, ruleId));
}

/**
 * Materialise one occurrence, atomically.
 *
 * Recurring rules are personal — never shared (there is no `household_id` on
 * `recurring_rules`) — so every occurrence posts to the rule owner's personal
 * space regardless of which space they currently have active. The caller
 * resolves and passes that space's id.
 *
 * Returns null when the (ruleId, occurrenceDate) pair already has a run —
 * the idempotent no-op path a double-fired tick takes.
 */
export async function materialiseOccurrence(
  db: Database,
  rule: RecurringRule,
  occurrenceDate: string,
  personalHouseholdId: string,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(transactions)
      .values({
        userId: rule.userId,
        householdId: personalHouseholdId,
        direction: rule.direction,
        amountCents: rule.amountCents,
        categoryId: rule.categoryId,
        note: rule.note,
        occurredOn: occurrenceDate,
        source: 'recurring',
        recurringRuleId: rule.id,
      })
      .returning({ id: transactions.id });

    const transactionId = inserted[0]?.id;
    if (!transactionId) throw new Error('Failed to create recurring transaction');

    const run = await tx
      .insert(recurringRuns)
      .values({ ruleId: rule.id, occurrenceDate, transactionId })
      .onConflictDoNothing({ target: [recurringRuns.ruleId, recurringRuns.occurrenceDate] })
      .returning({ id: recurringRuns.id });

    if (run.length === 0) {
      // Someone else's concurrent tick won the race for this occurrence — undo
      // the transaction we just inserted rather than double-charge it.
      await tx.delete(transactions).where(eq(transactions.id, transactionId));
      return null;
    }

    return transactionId;
  });
}

export interface RunSummary {
  ruleId: string;
  occurrenceDate: string;
  amountCents: number;
  direction: Direction;
  note: string | null;
}

/** What materialised in a given hour, for the digest line (PRD F9.6). */
export async function runsOn(
  db: Database,
  userId: string,
  occurrenceDate: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({
      ruleId: recurringRuns.ruleId,
      occurrenceDate: recurringRuns.occurrenceDate,
      amountCents: recurringRules.amountCents,
      direction: recurringRules.direction,
      note: recurringRules.note,
    })
    .from(recurringRuns)
    .innerJoin(recurringRules, eq(recurringRuns.ruleId, recurringRules.id))
    .where(
      and(eq(recurringRules.userId, userId), eq(recurringRuns.occurrenceDate, occurrenceDate)),
    );
  return rows;
}

/** True if this user logged anything at all today — for the nudge (PRD F9.5). */
export async function hasAnyTransactionOn(
  db: Database,
  userId: string,
  occurredOn: string,
): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.occurredOn, occurredOn)))
    .limit(1);
  return rows.length > 0;
}
