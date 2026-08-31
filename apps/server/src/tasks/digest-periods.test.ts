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
