/**
 * Shared read logic for the bot and the API.
 *
 * Both surfaces answer the same questions — what is safe to spend, what did I
 * spend today — so the arithmetic lives here once rather than being written
 * twice and drifting.
 */

import {
  addDays,
  calculateSafeToSpend,
  centsOf,
  isoDateOf,
  monthRange,
  parseIsoDate,
  type IsoDate,
  type SafeToSpendResult,
} from '@spendlygo/core';
import { transactionsRepo, type User } from '@spendlygo/db';
import type { Transaction as ApiTransaction } from '@spendlygo/shared';
import type { AppContext } from '../context.js';

export function todayFor(ctx: AppContext, user: User): IsoDate {
  return isoDateOf(ctx.clock.now(), user.timezone);
}

/** Serialise a repository row into the shape the Mini App compiles against. */
export function toApiTransaction(row: transactionsRepo.TransactionView): ApiTransaction {
  return {
    id: row.id,
    direction: row.direction,
    amountCents: row.amountCents,
    note: row.note,
    occurredOn: row.occurredOn,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    categoryId: row.categoryId,
    categorySlug: row.categorySlug,
    categoryName: row.categoryName,
    categoryEmoji: row.categoryEmoji,
    categoryColorToken: row.categoryColorToken,
  };
}

/**
 * The safe-to-spend figure for a user, right now.
 *
 * Recomputed on every call and never cached across a day boundary
 * (PRD F6.1) — the number is only worth trusting if it is current.
 */
export async function computeSafeToSpend(
  ctx: AppContext,
  user: User,
  today: IsoDate = todayFor(ctx, user),
): Promise<SafeToSpendResult> {
  const { year, month } = parseIsoDate(today);
  const period = monthRange(year, month);

  const [monthTotals, todayTotals] = await Promise.all([
    // Month-to-date, not the whole month: spending dated in the future must not
    // count against what is safe to spend today.
    transactionsRepo.totalsForPeriod(ctx.db, user.id, period.start, today),
    transactionsRepo.totalsForPeriod(ctx.db, user.id, today, today),
  ]);

  return calculateSafeToSpend({
    budgetCents: user.monthlyBudgetCents === null ? null : centsOf(user.monthlyBudgetCents),
    spentMonthToDateCents: centsOf(monthTotals.budgetedOutCents),
    spentTodayCents: centsOf(todayTotals.budgetedOutCents),
    today,
  });
}

/** The last `days` days ending today, gaps filled with zero, oldest first. */
export async function recentDailySpend(
  ctx: AppContext,
  user: User,
  today: IsoDate,
  days = 7,
): Promise<Array<{ day: IsoDate; outCents: number }>> {
  const from = addDays(today, -(days - 1));
  const rows = await transactionsRepo.totalsByDay(ctx.db, user.id, from, today);
  const byDay = new Map(rows.map((row) => [row.day, row.outCents]));

  const series: Array<{ day: IsoDate; outCents: number }> = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);
    series.push({ day, outCents: byDay.get(day) ?? 0 });
  }
  return series;
}
