/**
 * Transaction reads and writes.
 *
 * GUARDRAILS.md section 3: aggregate in SQL, never in JavaScript, and
 * soft-delete on user action. Section 4: every query filters by ownership
 * here, in the repository, so no call site can forget it.
 *
 * Households complicate "ownership" into two distinct questions, answered by
 * two distinct filters below:
 *
 *  - `visibleTo` (used by `list`, the personal/History feed): a household's
 *    shared entries, UNION the caller's own entries from before they had a
 *    household. A household's creator keeps seeing their carried-over
 *    history; a joining partner does not inherit it.
 *
 *  - `sharedScope` (used by every aggregate — safe-to-spend, Stats): STRICTLY
 *    the household's entries once in one, nothing from before it existed. Two
 *    partners must compute the identical shared number, and a creator's
 *    un-shared past spending would otherwise silently count against a
 *    partner who never logged it and never agreed to it.
 *
 * Mutations (`findById`, `update`, `softDelete`) stay author-only regardless
 * of household — full visibility, not full control. Nobody edits or deletes
 * a household-mate's entry.
 */

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { categories, transactions, users, type Transaction } from '../schema.js';

export type Direction = 'in' | 'out';
export type TransactionSource = 'chat' | 'miniapp' | 'recurring';

export interface CreateTransactionInput {
  userId: string;
  /** The author's household at the moment of logging — see the file header. */
  householdId: string | null;
  direction: Direction;
  amountCents: number;
  categoryId: string | null;
  note: string | null;
  occurredOn: string;
  source: TransactionSource;
}

/** A transaction with its category and author joined — what every screen shows. */
export interface TransactionView {
  id: string;
  userId: string;
  direction: Direction;
  amountCents: number;
  note: string | null;
  occurredOn: string;
  source: TransactionSource;
  createdAt: Date;
  categoryId: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  categoryColorToken: string | null;
  authorFirstName: string | null;
}

/** Rows this exact author may edit or delete. Never household-widened. */
function ownedByAuthor(userId: string) {
  return and(eq(transactions.userId, userId), isNull(transactions.deletedAt));
}

/** Rows this user should see in their personal feed — see the file header. */
function visibleTo(userId: string, householdId: string | null) {
  const ownership = householdId
    ? or(
        eq(transactions.householdId, householdId),
        and(eq(transactions.userId, userId), isNull(transactions.householdId)),
      )
    : eq(transactions.userId, userId);
  return and(ownership, isNull(transactions.deletedAt));
}

/** Rows that count toward the shared budget — see the file header. */
function sharedScope(userId: string, householdId: string | null) {
  const ownership = householdId
    ? eq(transactions.householdId, householdId)
    : eq(transactions.userId, userId);
  return and(ownership, isNull(transactions.deletedAt));
}

const viewColumns = {
  id: transactions.id,
  userId: transactions.userId,
  direction: transactions.direction,
  amountCents: transactions.amountCents,
  note: transactions.note,
  occurredOn: transactions.occurredOn,
  source: transactions.source,
  createdAt: transactions.createdAt,
  categoryId: transactions.categoryId,
  categorySlug: categories.slug,
  categoryName: categories.name,
  categoryEmoji: categories.emoji,
  categoryColorToken: categories.colorToken,
  authorFirstName: users.firstName,
};

/** Every view query joins the same two tables, in the same order. */
function baseViewQuery(db: Database) {
  return db
    .select(viewColumns)
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(users, eq(transactions.userId, users.id));
}

export async function create(db: Database, input: CreateTransactionInput): Promise<Transaction> {
  const rows = await db
    .insert(transactions)
    .values({
      userId: input.userId,
      householdId: input.householdId,
      direction: input.direction,
      amountCents: input.amountCents,
      categoryId: input.categoryId,
      note: input.note,
      occurredOn: input.occurredOn,
      source: input.source,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no transaction');
  return row;
}

/** Author-only — see the file header. */
export async function findById(
  db: Database,
  userId: string,
  id: string,
): Promise<TransactionView | null> {
  const rows = await baseViewQuery(db)
    .where(and(ownedByAuthor(userId), eq(transactions.id, id)))
    .limit(1);
  return (rows[0] as TransactionView | undefined) ?? null;
}

export interface ListOptions {
  /** Inclusive ISO date. */
  from?: string;
  /** Inclusive ISO date. */
  to?: string;
  limit?: number;
  offset?: number;
}

export async function list(
  db: Database,
  userId: string,
  householdId: string | null,
  options: ListOptions = {},
): Promise<TransactionView[]> {
  const filters = [visibleTo(userId, householdId)];
  if (options.from) filters.push(gte(transactions.occurredOn, options.from));
  if (options.to) filters.push(lte(transactions.occurredOn, options.to));

  const rows = await baseViewQuery(db)
    .where(and(...filters))
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .limit(Math.min(options.limit ?? 50, 200))
    .offset(options.offset ?? 0);

  return rows as TransactionView[];
}

/** Soft delete (PRD F11.3). Author-only — see the file header. */
export async function softDelete(db: Database, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(transactions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(ownedByAuthor(userId), eq(transactions.id, id)))
    .returning({ id: transactions.id });
  return rows.length > 0;
}

export interface UpdateTransactionInput {
  direction?: Direction;
  amountCents?: number;
  categoryId?: string | null;
  note?: string | null;
  occurredOn?: string;
}

/** Author-only — see the file header. */
export async function update(
  db: Database,
  userId: string,
  id: string,
  input: UpdateTransactionInput,
): Promise<TransactionView | null> {
  const rows = await db
    .update(transactions)
    .set({ ...input, updatedAt: new Date() })
    .where(and(ownedByAuthor(userId), eq(transactions.id, id)))
    .returning({ id: transactions.id });

  if (rows.length === 0) return null;
  return findById(db, userId, id);
}

// --- aggregates -------------------------------------------------------------
// GUARDRAILS.md section 7: these run in Postgres. Pulling a transaction history
// into Node to sum it would blow the 512 MB budget and get slower every month.
// All of them use `sharedScope` — see the file header for why that must be
// strict rather than the union `list` uses.

export interface PeriodTotals {
  inCents: number;
  outCents: number;
  /** Expenses that count toward the budget — excludes flagged categories. */
  budgetedOutCents: number;
  count: number;
}

export async function totalsForPeriod(
  db: Database,
  userId: string,
  householdId: string | null,
  from: string,
  to: string,
): Promise<PeriodTotals> {
  const rows = await db
    .select({
      inCents: sql<number>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amountCents} else 0 end), 0)::int`,
      outCents: sql<number>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amountCents} else 0 end), 0)::int`,
      // PRD F6.7: transfers and reimbursements must not distort safe-to-spend.
      budgetedOutCents: sql<number>`coalesce(sum(case when ${transactions.direction} = 'out' and coalesce(${categories.excludeFromBudget}, false) = false then ${transactions.amountCents} else 0 end), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        sharedScope(userId, householdId),
        gte(transactions.occurredOn, from),
        lte(transactions.occurredOn, to),
      ),
    );

  return rows[0] ?? { inCents: 0, outCents: 0, budgetedOutCents: 0, count: 0 };
}

export interface CategoryTotal {
  categoryId: string | null;
  slug: string | null;
  name: string | null;
  emoji: string | null;
  colorToken: string | null;
  outCents: number;
  count: number;
}

export async function totalsByCategory(
  db: Database,
  userId: string,
  householdId: string | null,
  from: string,
  to: string,
): Promise<CategoryTotal[]> {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      slug: categories.slug,
      name: categories.name,
      emoji: categories.emoji,
      colorToken: categories.colorToken,
      outCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        sharedScope(userId, householdId),
        eq(transactions.direction, 'out'),
        gte(transactions.occurredOn, from),
        lte(transactions.occurredOn, to),
      ),
    )
    .groupBy(
      transactions.categoryId,
      categories.slug,
      categories.name,
      categories.emoji,
      categories.colorToken,
    )
    .orderBy(desc(sql`sum(${transactions.amountCents})`));

  return rows as CategoryTotal[];
}

export interface DailyTotal {
  day: string;
  outCents: number;
  inCents: number;
}

/** One row per day that has activity. Gaps are filled by the caller. */
export async function totalsByDay(
  db: Database,
  userId: string,
  householdId: string | null,
  from: string,
  to: string,
): Promise<DailyTotal[]> {
  const rows = await db
    .select({
      day: transactions.occurredOn,
      outCents: sql<number>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amountCents} else 0 end), 0)::int`,
      inCents: sql<number>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amountCents} else 0 end), 0)::int`,
    })
    .from(transactions)
    .where(
      and(
        sharedScope(userId, householdId),
        gte(transactions.occurredOn, from),
        lte(transactions.occurredOn, to),
      ),
    )
    .groupBy(transactions.occurredOn)
    .orderBy(asc(transactions.occurredOn));

  return rows as DailyTotal[];
}

export interface MonthlyTotal {
  month: string;
  outCents: number;
  inCents: number;
}

export async function totalsByMonth(
  db: Database,
  userId: string,
  householdId: string | null,
  from: string,
  to: string,
): Promise<MonthlyTotal[]> {
  const monthExpr = sql<string>`to_char(${transactions.occurredOn}, 'YYYY-MM')`;

  const rows = await db
    .select({
      month: monthExpr,
      outCents: sql<number>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amountCents} else 0 end), 0)::int`,
      inCents: sql<number>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amountCents} else 0 end), 0)::int`,
    })
    .from(transactions)
    .where(
      and(
        sharedScope(userId, householdId),
        gte(transactions.occurredOn, from),
        lte(transactions.occurredOn, to),
      ),
    )
    .groupBy(monthExpr)
    .orderBy(asc(monthExpr));

  return rows as MonthlyTotal[];
}

/** Category ids ordered by how recently and often they were used (PRD F2.3). */
export async function frequentCategoryIds(
  db: Database,
  userId: string,
  householdId: string | null,
  limit = 8,
): Promise<string[]> {
  const rows = await db
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(and(sharedScope(userId, householdId), sql`${transactions.categoryId} is not null`))
    // Recency-weighted: a category used once yesterday outranks one used
    // twice six months ago.
    .groupBy(transactions.categoryId)
    .orderBy(desc(sql`count(*) + 3 * max(${transactions.occurredOn})::date - current_date`))
    .limit(limit);

  return rows.map((row) => row.categoryId).filter((id): id is string => id !== null);
}
