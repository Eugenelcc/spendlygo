/**
 * The digest family (PRD F9): daily, weekly and monthly.
 *
 * All three answer the same underlying question — "how did that period go,
 * and where do I stand now" — so they share the pace/tomorrow logic and only
 * differ in the range they summarise. None of them is ever a thread (F9.3),
 * and content is gated on being worth an interruption: a user with no budget
 * and no activity in the period gets nothing rather than an empty message.
 */

import {
  addDays,
  addMonths,
  daysInMonth,
  formatCents,
  isoWeekday,
  monthRange,
  parseIsoDate,
  type AmountCents,
  type IsoDate,
} from '@spendlygo/core';
import { recurringRepo, transactionsRepo, type User } from '@spendlygo/db';
import { computeSafeToSpend } from '../api/service.js';
import { escapeMarkdown } from '../bot/markdown.js';
import type { AppContext } from '../context.js';

const PACE_LABEL: Record<string, string> = {
  ahead: '🟢 ahead of pace',
  on_track: '🔵 on track',
  behind: '🟠 behind pace',
  over_budget: '🔴 over budget',
};

export interface DigestContent {
  text: string;
  /** False when there is nothing worth interrupting the user for. */
  worthSending: boolean;
}

// --- daily -------------------------------------------------------------------

export async function buildDailyDigest(
  ctx: AppContext,
  user: User,
  today: IsoDate,
): Promise<DigestContent> {
  const money = (cents: number) =>
    escapeMarkdown(
      formatCents(cents as AmountCents, { currency: user.currency, locale: user.locale }),
    );

  const [todayResult, tomorrowResult, runs, loggedToday] = await Promise.all([
    computeSafeToSpend(ctx, user, today),
    computeSafeToSpend(ctx, user, addDays(today, 1)),
    recurringRepo.runsOn(ctx.db, user.id, today),
    recurringRepo.hasAnyTransactionOn(ctx.db, user.id, today),
  ]);

  const lines: string[] = [`*Today* — ${money(todayResult.spentTodayCents)} spent`];

  if (todayResult.hasBudget) {
    lines.push(PACE_LABEL[todayResult.pace] ?? '');
  }

  if (runs.length > 0) {
    lines.push('', '*Logged automatically*');
    for (const run of runs) {
      const sign = run.direction === 'in' ? '+' : '−';
      lines.push(
        `${sign}${money(run.amountCents)}${run.note ? ` · ${escapeMarkdown(run.note)}` : ''}`,
      );
    }
  }

  if (tomorrowResult.hasBudget) {
    lines.push(
      '',
      tomorrowResult.overspentCents > 0
        ? `⚠️ Tomorrow starts *${money(tomorrowResult.overspentCents)}* over budget`
        : `*${money(tomorrowResult.safeTodayCents)}* safe to spend tomorrow`,
    );
  }

  const nudgeWorthy = user.nudgeEnabled && !loggedToday && runs.length === 0;
  if (nudgeWorthy) {
    lines.push('', "_You haven't logged anything today._");
  }

  const worthSending = todayResult.hasBudget || runs.length > 0 || nudgeWorthy;

  return { text: lines.join('\n'), worthSending };
}

// --- shared period summary -----------------------------------------------

interface PeriodSummaryOptions {
  heading: string;
  from: IsoDate;
  to: IsoDate;
  previousFrom: IsoDate;
  previousTo: IsoDate;
}

async function buildPeriodSummary(
  ctx: AppContext,
  user: User,
  options: PeriodSummaryOptions,
): Promise<DigestContent> {
  const money = (cents: number) =>
    escapeMarkdown(
      formatCents(cents as AmountCents, { currency: user.currency, locale: user.locale }),
    );

  const [totals, previous, byCategory, byDay, safeToSpend] = await Promise.all([
    transactionsRepo.totalsForPeriod(ctx.db, user.id, options.from, options.to),
    transactionsRepo.totalsForPeriod(ctx.db, user.id, options.previousFrom, options.previousTo),
    transactionsRepo.totalsByCategory(ctx.db, user.id, options.from, options.to),
    transactionsRepo.totalsByDay(ctx.db, user.id, options.from, options.to),
    computeSafeToSpend(ctx, user, options.to),
  ]);

  if (totals.count === 0 && !safeToSpend.hasBudget) {
    return { text: '', worthSending: false };
  }

  const lines: string[] = [`*${options.heading}* — ${money(totals.outCents)} spent`];

  if (safeToSpend.hasBudget) {
    lines.push(PACE_LABEL[safeToSpend.pace] ?? '');
  }

  if (previous.outCents > 0) {
    const delta = Math.round(((totals.outCents - previous.outCents) / previous.outCents) * 100);
    lines.push(
      delta === 0
        ? 'Same as the period before'
        : `${Math.abs(delta)}% ${delta > 0 ? 'more' : 'less'} than the period before`,
    );
  }

  if (byCategory.length > 0) {
    lines.push('', '*Top categories*');
    for (const category of byCategory.slice(0, 3)) {
      lines.push(
        `${category.emoji ?? '•'} ${escapeMarkdown(category.name ?? 'Uncategorised')} — ${money(category.outCents)}`,
      );
    }
  }

  // Every day counts, including a zero-spend day — that IS the best day.
  const dayOutById = new Map(byDay.map((row) => [row.day, row.outCents]));
  const allDays: IsoDate[] = [];
  let cursor = options.from;
  while (cursor <= options.to) {
    allDays.push(cursor);
    cursor = addDays(cursor, 1);
  }

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
      lines.push(
        '',
        `Lightest day: ${formatDayLabel(best)} · Heaviest: ${formatDayLabel(worst)} (${money(worstSpend)})`,
      );
    }
  }

  if (totals.inCents > 0) {
    lines.push('', `${money(totals.inCents)} received`);
  }

  return { text: lines.join('\n'), worthSending: true };
}

function formatDayLabel(date: IsoDate): string {
  const { month, day } = parseIsoDate(date);
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${day} ${names[month - 1]}`;
}

// --- weekly ------------------------------------------------------------------

/** PRD user preference: fires Sunday evening, at the same hour as the daily digest. */
export function isWeeklyDigestDay(today: IsoDate): boolean {
  return isoWeekday(today) === 7;
}

export async function buildWeeklyDigest(
  ctx: AppContext,
  user: User,
  today: IsoDate,
): Promise<DigestContent> {
  // Sunday is the digest day, so the week just finished is Monday..Sunday.
  const from = addDays(today, -6);
  const previousFrom = addDays(from, -7);
  const previousTo = addDays(from, -1);

  return buildPeriodSummary(ctx, user, {
    heading: 'This week',
    from,
    to: today,
    previousFrom,
    previousTo,
  });
}

// --- monthly -------------------------------------------------------------

export function isMonthlyDigestDay(today: IsoDate): boolean {
  const { year, month, day } = parseIsoDate(today);
  return day === daysInMonth(year, month);
}

export async function buildMonthlyDigest(
  ctx: AppContext,
  user: User,
  today: IsoDate,
): Promise<DigestContent> {
  const { year, month } = parseIsoDate(today);
  const range = monthRange(year, month);
  const previousAnchor = addMonths(range.start, -1);
  const previousParts = parseIsoDate(previousAnchor);
  const previousRange = monthRange(previousParts.year, previousParts.month);

  const monthName = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ][month - 1];

  return buildPeriodSummary(ctx, user, {
    heading: monthName ?? 'This month',
    from: range.start,
    to: today,
    previousFrom: previousRange.start,
    previousTo: previousRange.end,
  });
}

// send-digests.ts and the existing test suite import buildDigest for the
// daily case; kept as an alias rather than renaming every call site.
export { buildDailyDigest as buildDigest };
