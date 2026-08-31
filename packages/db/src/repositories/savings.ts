/**
 * Savings goals — reads and writes.
 *
 * Personal, not household-scoped: unlike a budget, a goal has exactly one
 * owner even inside a shared household, so every query here filters by
 * `userId` alone (GUARDRAILS.md section 4).
 *
 * Progress is never stored — it is the net of transactions tagged to the
 * goal (`transactions.savingsGoalId`), aggregated in SQL here
 * (GUARDRAILS.md section 3) and turned into a verdict by
 * `packages/core/src/savings.ts#calculateGoalProgress`.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { savingsGoals, transactions, type SavingsGoal } from '../schema.js';

/** A goal with its net contribution joined in. Can be negative — see the file header. */
export interface SavingsGoalWithContribution extends SavingsGoal {
  netContributedCents: number;
}

const contributionExpr = sql<number>`coalesce(sum(case
  when ${transactions.direction} = 'out' then ${transactions.amountCents}
  else -${transactions.amountCents}
end), 0)::int`;

/** Author-only, joined with its net contribution. */
function baseQuery(db: Database) {
  return db
    .select({
      id: savingsGoals.id,
      userId: savingsGoals.userId,
      name: savingsGoals.name,
      targetCents: savingsGoals.targetCents,
      targetDate: savingsGoals.targetDate,
      archivedAt: savingsGoals.archivedAt,
      createdAt: savingsGoals.createdAt,
      updatedAt: savingsGoals.updatedAt,
      netContributedCents: contributionExpr,
    })
    .from(savingsGoals)
    .leftJoin(
      transactions,
      and(eq(transactions.savingsGoalId, savingsGoals.id), isNull(transactions.deletedAt)),
    )
    .groupBy(savingsGoals.id);
}

export interface CreateSavingsGoalInput {
  userId: string;
  name: string;
  targetCents: number;
  targetDate: string | null;
}

export async function create(db: Database, input: CreateSavingsGoalInput): Promise<SavingsGoal> {
  const rows = await db
    .insert(savingsGoals)
    .values({
      userId: input.userId,
      name: input.name,
      targetCents: input.targetCents,
      targetDate: input.targetDate,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no savings goal');
  return row;
}

export async function listForUser(
  db: Database,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<SavingsGoalWithContribution[]> {
  const ownership = eq(savingsGoals.userId, userId);
  const where = options.includeArchived
    ? ownership
    : and(ownership, isNull(savingsGoals.archivedAt));

  const rows = await baseQuery(db).where(where).orderBy(desc(savingsGoals.createdAt));
  return rows;
}

/** Author-only. */
export async function findById(
  db: Database,
  userId: string,
  id: string,
): Promise<SavingsGoalWithContribution | null> {
  const rows = await baseQuery(db)
    .where(and(eq(savingsGoals.userId, userId), eq(savingsGoals.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpdateSavingsGoalInput {
  name?: string;
  targetCents?: number;
  targetDate?: string | null;
}

/** Author-only. */
export async function update(
  db: Database,
  userId: string,
  id: string,
  input: UpdateSavingsGoalInput,
): Promise<boolean> {
  const rows = await db
    .update(savingsGoals)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(savingsGoals.userId, userId), eq(savingsGoals.id, id)))
    .returning({ id: savingsGoals.id });
  return rows.length > 0;
}

/** Archive, never delete — matches categories (PRD F10.3). Author-only. */
export async function archive(db: Database, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(savingsGoals)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(savingsGoals.userId, userId),
        eq(savingsGoals.id, id),
        isNull(savingsGoals.archivedAt),
      ),
    )
    .returning({ id: savingsGoals.id });
  return rows.length > 0;
}
