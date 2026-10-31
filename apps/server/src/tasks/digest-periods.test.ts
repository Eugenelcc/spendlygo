/**
 * Pure date-boundary tests for the weekly/monthly digest gates. These are
 * cheap and deterministic — no database needed — and cover exactly the kind
 * of off-by-one that a "which day is Sunday" or "which day is month-end"
 * check invites.
 */

import { describe, expect, it } from 'vitest';
import type { IsoDate } from '@spendlygo/core';
import { isMonthlyDigestDay, isWeeklyDigestDay } from './digest.js';

const iso = (d: string) => d as IsoDate;

describe('isWeeklyDigestDay', () => {
  it('is true only on Sunday', () => {
    // 2026-08-30 is a Sunday.
    expect(isWeeklyDigestDay(iso('2026-08-30'))).toBe(true);
  });

  it('is false on every other day of the week', () => {
    for (const day of ['24', '25', '26', '27', '28', '29'] as const) {
      expect(isWeeklyDigestDay(iso(`2026-08-${day}`))).toBe(false);
    }
  });

  it('is true across a month boundary landing on Sunday', () => {
    // 2026-08-30 (Sun) + 7 = 2026-09-06, also a Sunday.
    expect(isWeeklyDigestDay(iso('2026-09-06'))).toBe(true);
  });
});

describe('isMonthlyDigestDay', () => {
  it('is true on the 31st of a 31-day month', () => {
    expect(isMonthlyDigestDay(iso('2026-08-31'))).toBe(true);
    expect(isMonthlyDigestDay(iso('2026-08-30'))).toBe(false);
  });

  it('is true on the 28th of a non-leap February', () => {
    expect(isMonthlyDigestDay(iso('2026-02-28'))).toBe(true);
    expect(isMonthlyDigestDay(iso('2026-02-27'))).toBe(false);
  });

  it('is true on the 29th of a leap February, not the 28th', () => {
    expect(isMonthlyDigestDay(iso('2024-02-29'))).toBe(true);
    expect(isMonthlyDigestDay(iso('2024-02-28'))).toBe(false);
  });

  it('is true on the 30th of a 30-day month', () => {
    expect(isMonthlyDigestDay(iso('2026-04-30'))).toBe(true);
    expect(isMonthlyDigestDay(iso('2026-04-29'))).toBe(false);
  });

  it('can coincide with the weekly digest — the one accepted overlap', () => {
    // Documents the case send-digests.ts explicitly chooses not to special-case.
    const lastDaySunday = iso('2026-08-30');
    expect(isMonthlyDigestDay(lastDaySunday)).toBe(false); // August has 31 days
    // Find a real coincidence instead: 2026-05-31 is a Sunday AND month-end.
    expect(isWeeklyDigestDay(iso('2026-05-31'))).toBe(true);
    expect(isMonthlyDigestDay(iso('2026-05-31'))).toBe(true);
  });
});

// F17 (B-032 Part 2, P2-AC9 to AC11): the monthly digest fires on the last day
// of the budget cycle, not the calendar month. The second argument is the
// space's start day; it does not exist yet, so the day-20 and day-31 cases fail.
describe('isMonthlyDigestDay with a cycle', () => {
  const withStartDay = isMonthlyDigestDay as (date: IsoDate, startDay?: number) => boolean;

  it('day 20 fires on the 19th, including across the new year', () => {
    expect(withStartDay(iso('2026-11-19'), 20)).toBe(true);
    expect(withStartDay(iso('2027-01-19'), 20)).toBe(true);
    expect(withStartDay(iso('2026-10-31'), 20)).toBe(false);
    expect(withStartDay(iso('2026-11-30'), 20)).toBe(false);
  });

  it('day 31 fires on 27 Feb (common) and 28 Feb (leap)', () => {
    expect(withStartDay(iso('2026-02-27'), 31)).toBe(true);
    expect(withStartDay(iso('2028-02-28'), 31)).toBe(true);
    expect(withStartDay(iso('2026-02-28'), 31)).toBe(false);
    expect(withStartDay(iso('2028-02-29'), 31)).toBe(false);
  });

  it('day 1 matches the calendar month end (regression guard)', () => {
    for (const date of ['2026-08-31', '2026-02-28', '2024-02-29', '2026-04-30']) {
      expect(withStartDay(iso(date))).toBe(true);
      expect(withStartDay(iso(date), 1)).toBe(true);
    }
    for (const date of ['2026-08-30', '2026-02-27', '2024-02-28', '2026-04-29']) {
      expect(withStartDay(iso(date))).toBe(false);
      expect(withStartDay(iso(date), 1)).toBe(false);
    }
  });
});
