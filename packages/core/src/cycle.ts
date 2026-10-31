/**
 * The budget cycle (PRD F17): the "month" a space budgets over, running from a
 * chosen start day to the day before it in the next month.
 *
 * A start day that does not exist in a short month uses that month's last day,
 * the same clamping rule recurrence uses (PRD F5.2). Start day 1 is exactly the
 * calendar month.
 */

import { ValidationError } from './errors.js';
import {
  addDays,
  clampDayOfMonth,
  daysBetween,
  monthName,
  parseIsoDate,
  toIsoDate,
  type DateRange,
  type IsoDate,
} from './time.js';

export interface BudgetCycle extends DateRange {
  /** The space's setting, 1-31. */
  startDay: number;
  /** end - start + 1. */
  days: number;
}

export const DEFAULT_CYCLE_START_DAY = 1;

export function assertCycleStartDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new ValidationError(`Cycle start day must be a whole number from 1 to 31, got ${day}`);
  }
}

/** The cycle start that falls in calendar month `month` (1-12), clamped. */
export function cycleStartIn(year: number, month: number, startDay: number): IsoDate {
  return toIsoDate({ year, month, day: clampDayOfMonth(year, month, startDay) });
}

function monthAfter(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function monthBefore(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** The cycle that contains `date` (a date already resolved in the user's timezone). */
export function cycleContaining(date: IsoDate, startDay: number): BudgetCycle {
  assertCycleStartDay(startDay);
  const { year, month } = parseIsoDate(date);

  const thisMonthStart = cycleStartIn(year, month, startDay);
  let startYear = year;
  let startMonth = month;
  if (date < thisMonthStart) {
    ({ year: startYear, month: startMonth } = monthBefore(year, month));
  }
  const start = cycleStartIn(startYear, startMonth, startDay);
  const following = monthAfter(startYear, startMonth);
  const end = addDays(cycleStartIn(following.year, following.month, startDay), -1);

  return { start, end, startDay, days: daysBetween(start, end) + 1 };
}

export function previousCycle(cycle: BudgetCycle): BudgetCycle {
  return cycleContaining(addDays(cycle.start, -1), cycle.startDay);
}

export function nextCycle(cycle: BudgetCycle): BudgetCycle {
  return cycleContaining(addDays(cycle.end, 1), cycle.startDay);
}

export function isLastDayOfCycle(date: IsoDate, startDay: number): boolean {
  return cycleContaining(date, startDay).end === date;
}

function shortDate(date: IsoDate): string {
  const { day, month } = parseIsoDate(date);
  return `${day} ${monthName(month).slice(0, 3)}`;
}

/** "20 Oct – 19 Nov". Never a year on screen (Q5). */
export function formatCycleRange(range: DateRange): string {
  return `${shortDate(range.start)} – ${shortDate(range.end)}`;
}

/**
 * The alert key of a cycle (PRD F13, Q2 A): the calendar year and month the
 * cycle ENDS in. For start day 1 that is the calendar month itself, so rows
 * written before F17 still match. For a fixed start day every cycle ends in a
 * different month, so the key is unique per cycle.
 */
export function cycleAlertKey(cycle: BudgetCycle): { year: number; month: number } {
  const { year, month } = parseIsoDate(cycle.end);
  return { year, month };
}
