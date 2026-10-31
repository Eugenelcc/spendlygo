/**
 * Pure tests for the bot's /today text (B-032 Part 1, P1-AC24). No DB.
 */

import { describe, expect, it } from 'vitest';
import { calculateSafeToSpend, centsOf, cycleContaining, type IsoDate } from '@spendlygo/core';
import { buildTodayText } from './money.js';

const TODAY = '2026-10-31' as IsoDate;
const user = { currency: 'SGD', locale: 'en-SG' };
const streak = { current: 0, longest: 0 };

function textFor(startDay: number): string {
  const cycle = cycleContaining(TODAY, startDay);
  const result = calculateSafeToSpend({
    budgetCents: centsOf(150_000),
    spentMonthToDateCents: centsOf(5_000),
    spentTodayCents: centsOf(0),
    today: TODAY,
    cycle,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return buildTodayText({ user, today: TODAY, result, streak, cycle } as any);
}

describe('/today text', () => {
  it('names the cycle range for day 20 and is unchanged for day 1', () => {
    const day20 = textFor(20);
    expect(day20).toContain('20 Oct – 19 Nov: S$50.00 of S$1,500.00');
    expect(day20).not.toContain('This month');

    const day1 = textFor(1);
    expect(day1).toContain('This month: S$50.00 of S$1,500.00');
    expect(day1).not.toContain('20 Oct');
  });
});
