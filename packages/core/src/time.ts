/**
 * Calendar arithmetic in the user's timezone.
 *
 * GUARDRAILS.md section 9: a "day", "month" or "year" boundary is NEVER
 * computed in UTC or in server-local time. A 00:30 supper in Singapore belongs
 * to that calendar day, not to the previous one in UTC.
 *
 * Statistics group by `occurred_on`, a plain calendar date already resolved in
 * the user's timezone, which keeps the SQL simple and the aggregates correct.
 */

import { ValidationError } from './errors.js';

/** A calendar date in `YYYY-MM-DD` form. No time, no zone. */
export type IsoDate = string & { readonly __isoDate?: true };

export interface CalendarDate {
  year: number;
  /** 1-12. Not the JavaScript 0-11 convention. */
  month: number;
  day: number;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function assertTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) {
    throw new ValidationError(`Unknown timezone: ${timeZone}`);
  }
}

/** Wall-clock fields of `instant` as observed in `timeZone`. */
function wallClockParts(
  instant: Date,
  timeZone: string,
): CalendarDate & {
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new ValidationError(`Could not read ${type} in ${timeZone}`);
    return Number(part.value);
  };

  // Some engines render midnight as hour 24 under hour12:false.
  const hour = read('hour') % 24;

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** The calendar date `instant` falls on, as seen from `timeZone`. */
export function calendarDateOf(instant: Date, timeZone: string): CalendarDate {
  assertTimeZone(timeZone);
  const { year, month, day } = wallClockParts(instant, timeZone);
  return { year, month, day };
}

/** The calendar date `instant` falls on, as `YYYY-MM-DD`. */
export function isoDateOf(instant: Date, timeZone: string): IsoDate {
  return toIsoDate(calendarDateOf(instant, timeZone));
}

export function toIsoDate(date: CalendarDate): IsoDate {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}` as IsoDate;
}

export function parseIsoDate(value: string): CalendarDate {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) throw new ValidationError(`Expected YYYY-MM-DD, received "${value}"`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) throw new ValidationError(`Invalid month in "${value}"`);
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new ValidationError(`Invalid day in "${value}"`);
  }
  return { year, month, day };
}

export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Days in a given month. Handles leap years, including the 400-year rule. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) throw new ValidationError(`Invalid month ${month}`);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Clamp a day-of-month to the last valid day of that month.
 *
 * A recurring rule anchored to the 31st must fire on 28 February, not spill
 * into March. See PRD F5.2.
 */
export function clampDayOfMonth(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toIsoDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  return toIsoDate({
    year: targetYear,
    month: targetMonth,
    day: clampDayOfMonth(targetYear, targetMonth, day),
  });
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  const msPerDay = 86_400_000;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / msPerDay,
  );
}

export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface DateRange {
  /** Inclusive. */
  start: IsoDate;
  /** Inclusive. */
  end: IsoDate;
}

export function monthRange(year: number, month: number): DateRange {
  return {
    start: toIsoDate({ year, month, day: 1 }),
    end: toIsoDate({ year, month, day: daysInMonth(year, month) }),
  };
}

export function yearRange(year: number): DateRange {
  return {
    start: toIsoDate({ year, month: 1, day: 1 }),
    end: toIsoDate({ year, month: 12, day: 31 }),
  };
}

/** ISO 8601 weekday, 1 = Monday .. 7 = Sunday. */
export function isoWeekday(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

/**
 * The instant at which the given calendar date begins in `timeZone`.
 *
 * Resolved by measuring the zone's offset at an approximation and correcting,
 * which stays right across DST transitions in zones that have them.
 */
export function startOfDayInstant(date: IsoDate, timeZone: string): Date {
  assertTimeZone(timeZone);
  const { year, month, day } = parseIsoDate(date);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);

  let instant = new Date(wallClockAsUtc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const seen = wallClockParts(instant, timeZone);
    const seenAsUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      seen.second,
    );
    const drift = seenAsUtc - wallClockAsUtc;
    if (drift === 0) break;
    instant = new Date(instant.getTime() - drift);
  }
  return instant;
}

/** The hour (0-23) that `instant` falls in, as seen from `timeZone`. */
export function hourOf(instant: Date, timeZone: string): number {
  assertTimeZone(timeZone);
  return wallClockParts(instant, timeZone).hour;
}
