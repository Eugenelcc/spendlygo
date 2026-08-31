/**
 * Shared read logic for the bot and the API.
 *
 * Both surfaces answer the same questions — what is safe to spend, what did I
 * spend today — so the arithmetic lives here once rather than being written
 * twice and drifting.
 */

import {
  addDays,
  calculateGoalProgress,
  calculateSafeToSpend,
  calculateStreak,
  centsOf,
  isoDateOf,
  monthRange,
  parseIsoDate,
  type AmountCents,
  type IsoDate,
  type SafeToSpendResult,
  type StreakResult,
} from '@spendlygo/core';
import {
  householdsRepo,
  transactionsRepo,
  type SavingsGoalWithContribution,
  type User,
} from '@spendlygo/db';
import type {
  SavingsGoal as ApiSavingsGoal,
  Transaction as ApiTransaction,
} from '@spendlygo/shared';
import type { AppContext } from '../context.js';

export function todayFor(ctx: AppContext, user: User): IsoDate {
  return isoDateOf(ctx.clock.now(), user.timezone);
}

/**
 * The budget a user actually sees.
 *
 * Once in a household, the household's figure governs — set by whichever
 * partner last changed it — and the user's own `monthlyBudgetCents` is simply
 * not consulted. Leaving a household falls straight back to it, unedited.
 */
export async function effectiveBudgetCents(
  ctx: AppContext,
  user: User,
): Promise<AmountCents | null> {
  if (user.householdId === null) {
    return user.monthlyBudgetCents === null ? null : centsOf(user.monthlyBudgetCents);
  }
  const household = await householdsRepo.findById(ctx.db, user.householdId);
  if (household === null || household.monthlyBudgetCents === null) return null;
  return centsOf(household.monthlyBudgetCents);
}

/** Serialise a repository row into the shape the Mini App compiles against. */
export function toApiTransaction(
  row: transactionsRepo.TransactionView,
  viewerUserId: string,
): ApiTransaction {
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
    authorUserId: row.userId,
    authorName: row.authorFirstName ?? 'Someone',
    isOwn: row.userId === viewerUserId,
    hasPhoto: row.hasPhoto,
  };
}

/**
 * The safe-to-spend figure for a user, right now.
 *
 * Recomputed on every call and never cached across a day boundary
 * (PRD F6.1) — the number is only worth trusting if it is current. In a
 * household, this is the one number both partners see identically — see
 * packages/db/src/repositories/transactions.ts for why the underlying totals
 * are scoped strictly to the household rather than including either
 * partner's pre-sharing history.
 */
export async function computeSafeToSpend(
  ctx: AppContext,
  user: User,
  today: IsoDate = todayFor(ctx, user),
): Promise<SafeToSpendResult> {
  const { year, month } = parseIsoDate(today);
  const period = monthRange(year, month);

  const [budgetCents, monthTotals, todayTotals] = await Promise.all([
    effectiveBudgetCents(ctx, user),
    // Month-to-date, not the whole month: spending dated in the future must not
    // count against what is safe to spend today.
    transactionsRepo.totalsForPeriod(ctx.db, user.id, user.householdId, period.start, today),
    transactionsRepo.totalsForPeriod(ctx.db, user.id, user.householdId, today, today),
  ]);

  return calculateSafeToSpend({
    budgetCents,
    spentMonthToDateCents: centsOf(monthTotals.budgetedOutCents),
    spentTodayCents: centsOf(todayTotals.budgetedOutCents),
    today,
  });
}

/** Serialise a goal row plus its net contribution into the progress the client renders. */
export function toApiSavingsGoal(
  goal: SavingsGoalWithContribution,
  today: IsoDate,
): ApiSavingsGoal {
  const progress = calculateGoalProgress({
    targetCents: centsOf(goal.targetCents),
    netContributedCents: goal.netContributedCents,
    today,
    targetDate: goal.targetDate as IsoDate | null,
  });

  return {
    id: goal.id,
    name: goal.name,
    targetCents: progress.targetCents,
    targetDate: goal.targetDate,
    contributedCents: progress.contributedCents,
    remainingCents: progress.remainingCents,
    achieved: progress.achieved,
    overdue: progress.overdue,
    monthsRemaining: progress.monthsRemaining,
    suggestedMonthlyCents: progress.suggestedMonthlyCents,
    progressRatio: progress.progressRatio,
  };
}

// A year plus change of history is enough to find a genuine "longest streak"
// without an unbounded scan as an account ages.
const STREAK_LOOKBACK_DAYS = 366;

/**
 * Days logged in a row. Personal even inside a shared household — see
 * `transactionsRepo.distinctLoggedDates`.
 */
export async function computeStreak(
  ctx: AppContext,
  user: User,
  today: IsoDate,
): Promise<StreakResult> {
  const since = addDays(today, -STREAK_LOOKBACK_DAYS);
  const loggedDates = await transactionsRepo.distinctLoggedDates(ctx.db, user.id, since);
  return calculateStreak(loggedDates as IsoDate[], today);
}

export interface PeriodStatsOptions {
  from: IsoDate;
  to: IsoDate;
  previousFrom: IsoDate;
  previousTo: IsoDate;
}

export interface PeriodStats {
  from: IsoDate;
  to: IsoDate;
  totals: transactionsRepo.PeriodTotals;
  previousOutCents: number;
  /** Percent change vs. the previous period. Null with nothing to compare against. */
  deltaPct: number | null;
  /** Every category with spend, highest first. Callers slice to taste. */
  byCategory: transactionsRepo.CategoryTotal[];
  /** Every day in the range counts, including a zero-spend one — that IS the best day. */
  bestDay: { day: IsoDate; outCents: number } | null;
  /** Null for a single-day period, or when nothing was spent on any day. */
  worstDay: { day: IsoDate; outCents: number } | null;
  safeToSpend: SafeToSpendResult;
}

/**
 * The numbers behind both the periodic digest (apps/server/src/tasks/
 * digest.ts) and the on-demand recap (apps/server/src/api/recap.ts) — one
 * set of queries, formatted two different ways for two different moods.
 */
export async function computePeriodStats(
  ctx: AppContext,
  user: User,
  options: PeriodStatsOptions,
): Promise<PeriodStats> {
  const { from, to, previousFrom, previousTo } = options;

  const [totals, previous, byCategory, byDay, safeToSpend] = await Promise.all([
    transactionsRepo.totalsForPeriod(ctx.db, user.id, user.householdId, from, to),
    transactionsRepo.totalsForPeriod(ctx.db, user.id, user.householdId, previousFrom, previousTo),
    transactionsRepo.totalsByCategory(ctx.db, user.id, user.householdId, from, to),
    transactionsRepo.totalsByDay(ctx.db, user.id, user.householdId, from, to),
    computeSafeToSpend(ctx, user, to),
  ]);

  const deltaPct =
    previous.outCents > 0
      ? Math.round(((totals.outCents - previous.outCents) / previous.outCents) * 100)
      : null;

  const dayOutById = new Map(byDay.map((row) => [row.day, row.outCents]));
  const allDays: IsoDate[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) allDays.push(cursor);

  let bestDay: { day: IsoDate; outCents: number } | null = null;
  let worstDay: { day: IsoDate; outCents: number } | null = null;
  if (allDays.length > 1) {
    let best = allDays[0] as IsoDate;
    let worst = allDays[0] as IsoDate;
    for (const day of allDays) {
      const spend = dayOutById.get(day) ?? 0;
      if (spend < (dayOutById.get(best) ?? 0)) best = day;
      if (spend > (dayOutById.get(worst) ?? 0)) worst = day;
    }
    const worstSpend = dayOutById.get(worst) ?? 0;
    if (worstSpend > 0) {
      bestDay = { day: best, outCents: dayOutById.get(best) ?? 0 };
      worstDay = { day: worst, outCents: worstSpend };
    }
  }

  return {
    from,
    to,
    totals,
    previousOutCents: previous.outCents,
    deltaPct,
    byCategory,
    bestDay,
    worstDay,
    safeToSpend,
  };
}

/** The last `days` days ending today, gaps filled with zero, oldest first. */
export async function recentDailySpend(
  ctx: AppContext,
  user: User,
  today: IsoDate,
  days = 7,
): Promise<Array<{ day: IsoDate; outCents: number }>> {
  const from = addDays(today, -(days - 1));
  const rows = await transactionsRepo.totalsByDay(ctx.db, user.id, user.householdId, from, today);
  const byDay = new Map(rows.map((row) => [row.day, row.outCents]));

  const series: Array<{ day: IsoDate; outCents: number }> = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);
    series.push({ day, outCents: byDay.get(day) ?? 0 });
  }
  return series;
}
