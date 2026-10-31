/**
 * The recap (PRD-adjacent): an on-demand, Wrapped-style summary of a month or
 * a year, distinct from the periodic digest (apps/server/src/tasks/
 * digest.ts) even though both are built from the same underlying numbers
 * (`computePeriodStats`). The digest's job is a quiet nudge on a schedule;
 * the recap's job is a shareable "look what you did" the user asks for.
 */

import {
  cycleContaining,
  formatCycleRange,
  monthName,
  parseIsoDate,
  previousCycle,
  yearRange,
  type IsoDate,
} from '@spendlygo/core';
import type { User } from '@spendlygo/db';
import type { AppContext } from '../context.js';
import {
  activeSpaceSettings,
  computePeriodStats,
  computeStreak,
  type PeriodStats,
} from './service.js';

export type RecapPeriod = 'month' | 'year';

export interface RecapData {
  period: RecapPeriod;
  label: string;
  from: IsoDate;
  to: IsoDate;
  stats: PeriodStats;
  streak: { current: number; longest: number };
}

function rangeFor(period: RecapPeriod, anchor: IsoDate, cycleStartDay: number) {
  const { year } = parseIsoDate(anchor);

  if (period === 'year') {
    const range = yearRange(year);
    const previous = yearRange(year - 1);
    return {
      from: range.start,
      to: range.end,
      previousFrom: previous.start,
      previousTo: previous.end,
      label: String(year),
    };
  }

  // The budget cycle containing the anchor (F17); start day 1 is the calendar month.
  const cycle = cycleContaining(anchor, cycleStartDay);
  const previous = previousCycle(cycle);
  return {
    from: cycle.start,
    to: cycle.end,
    previousFrom: previous.start,
    previousTo: previous.end,
    label:
      cycleStartDay === 1
        ? `${monthName(parseIsoDate(cycle.start).month)} ${parseIsoDate(cycle.start).year}`
        : formatCycleRange(cycle),
  };
}

/**
 * `anchor` picks the period, not necessarily today — `/recap` defaults to
 * the period containing today, but the caller (bot or API) can point at any
 * past month or year.
 */
export async function buildRecap(
  ctx: AppContext,
  user: User,
  period: RecapPeriod,
  anchor: IsoDate,
  today: IsoDate,
): Promise<RecapData> {
  const { cycleStartDay } = await activeSpaceSettings(ctx, user);
  const range = rangeFor(period, anchor, cycleStartDay);
  // A recap of a period still in progress must not read past today —
  // spending "dated in the future" can't exist, but the safe-to-spend figure
  // inside computePeriodStats still needs a real "as of" date.
  const to = range.to > today ? today : range.to;

  const [stats, streak] = await Promise.all([
    computePeriodStats(ctx, user, {
      from: range.from,
      to,
      previousFrom: range.previousFrom,
      previousTo: range.previousTo,
    }),
    computeStreak(ctx, user, today),
  ]);

  return { period, label: range.label, from: range.from, to, stats, streak };
}
