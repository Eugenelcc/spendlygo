/**
 * Recurring transaction dates (PRD F5).
 *
 * GUARDRAILS.md section 9: no `new Date()`, every date is a plain IsoDate
 * computed from an explicit anchor. Month-end clamping (F5.2) means a rule
 * anchored to the 31st fires on the last day of a shorter month rather than
 * skipping it or spilling into the next one.
 */

import {
  addDays,
  addMonths,
  clampDayOfMonth,
  compareIsoDate,
  parseIsoDate,
  toIsoDate,
  type IsoDate,
} from './time.js';
import { ValidationError } from './errors.js';
import type { Direction } from './parser.js';

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  cadence: Cadence;
  /** The date the rule was created against — the first possible occurrence. */
  anchorDate: IsoDate;
  /** Monthly/yearly only: 1-31, clamped to the month's real length. */
  dayOfMonth: number | null;
  /** Inclusive. No occurrences after this date. */
  endDate: IsoDate | null;
}

/** The occurrence immediately after `after` (exclusive), or null past `endDate`. */
export function nextOccurrence(rule: RecurrenceRule, after: IsoDate): IsoDate | null {
  const candidate = firstOccurrenceOnOrAfter(rule, addDays(after, 1));
  if (candidate === null) return null;
  if (rule.endDate !== null && compareIsoDate(candidate, rule.endDate) > 0) return null;
  return candidate;
}

/**
 * Every occurrence in `[from, to]`, inclusive on both ends.
 *
 * PRD F5.4: this is what backfills a rule after the service was asleep or
 * down — every missed occurrence is produced, none silently skipped.
 */
export function occurrencesInRange(rule: RecurrenceRule, from: IsoDate, to: IsoDate): IsoDate[] {
  if (compareIsoDate(from, to) > 0) return [];

  const occurrences: IsoDate[] = [];
  let candidate = firstOccurrenceOnOrAfter(rule, from);

  // A guard against an impossible cadence looping forever; 10 years of daily
  // occurrences is already far more than any real backfill window.
  const SAFETY_LIMIT = 3660;

  for (let i = 0; candidate !== null && i < SAFETY_LIMIT; i += 1) {
    if (compareIsoDate(candidate, to) > 0) break;
    if (rule.endDate !== null && compareIsoDate(candidate, rule.endDate) > 0) break;

    occurrences.push(candidate);
    candidate = stepForward(rule, candidate);
  }

  return occurrences;
}

function firstOccurrenceOnOrAfter(rule: RecurrenceRule, from: IsoDate): IsoDate | null {
  if (compareIsoDate(rule.anchorDate, from) >= 0) {
    return alignToAnchor(rule, rule.anchorDate);
  }

  // Walk forward from the anchor in cadence-sized jumps rather than day by
  // day, so a rule anchored years ago still resolves instantly.
  let candidate = rule.anchorDate;
  while (compareIsoDate(candidate, from) < 0) {
    const next = stepForward(rule, candidate);
    if (next === null) return null;
    candidate = next;
  }
  return candidate;
}

function stepForward(rule: RecurrenceRule, from: IsoDate): IsoDate | null {
  switch (rule.cadence) {
    case 'daily':
      return addDays(from, 1);
    case 'weekly':
      return addDays(from, 7);
    case 'monthly':
      return alignToAnchor(rule, addMonths(from, 1));
    case 'yearly':
      return alignToAnchor(rule, addYears(from, 1));
  }
}

function addYears(date: IsoDate, years: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  return toIsoDate({ year: year + years, month, day: clampDayOfMonth(year + years, month, day) });
}

/** Re-applies `dayOfMonth`, so month-length drift never accumulates across steps. */
function alignToAnchor(rule: RecurrenceRule, date: IsoDate): IsoDate {
  if (rule.dayOfMonth === null || (rule.cadence !== 'monthly' && rule.cadence !== 'yearly')) {
    return date;
  }
  const { year, month } = parseIsoDate(date);
  return toIsoDate({ year, month, day: clampDayOfMonth(year, month, rule.dayOfMonth) });
}

export function validateRecurrenceRule(rule: RecurrenceRule): void {
  if ((rule.cadence === 'monthly' || rule.cadence === 'yearly') && rule.dayOfMonth === null) {
    throw new ValidationError(`A ${rule.cadence} rule needs a dayOfMonth`);
  }
  if (rule.dayOfMonth !== null && (rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) {
    throw new ValidationError('dayOfMonth must be between 1 and 31');
  }
  if (rule.endDate !== null && compareIsoDate(rule.endDate, rule.anchorDate) < 0) {
    throw new ValidationError('endDate cannot be before anchorDate');
  }
}

export interface RecurringRuleInput {
  direction: Direction;
  amountCents: number;
  note: string | null;
  cadence: Cadence;
  anchorDate: IsoDate;
  dayOfMonth: number | null;
  endDate: IsoDate | null;
}
