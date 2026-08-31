import { describe, expect, it } from 'vitest';
import { calculateGoalProgress, monthsRemainingUntil } from './savings.js';
import { centsOf } from './money.js';
import type { IsoDate } from './time.js';

const dollars = (value: number) => centsOf(Math.round(value * 100));

describe('calculateGoalProgress', () => {
  it('reports progress toward an untouched goal', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(1000),
      netContributedCents: 0,
      today: '2026-08-01' as IsoDate,
      targetDate: null,
    });
    expect(result.contributedCents).toBe(0);
    expect(result.remainingCents).toBe(dollars(1000));
    expect(result.achieved).toBe(false);
    expect(result.overdue).toBe(false);
    expect(result.progressRatio).toBe(0);
  });

  it('tracks partial contribution', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(1000),
      netContributedCents: dollars(400),
      today: '2026-08-01' as IsoDate,
      targetDate: null,
    });
    expect(result.contributedCents).toBe(dollars(400));
    expect(result.remainingCents).toBe(dollars(600));
    expect(result.progressRatio).toBeCloseTo(0.4);
    expect(result.achieved).toBe(false);
  });

  it('clamps a net-negative contribution history to zero progress, not a negative bar', () => {
    // A goal that had money pulled back out (in-tagged > out-tagged).
    const result = calculateGoalProgress({
      targetCents: dollars(1000),
      netContributedCents: dollars(-50),
      today: '2026-08-01' as IsoDate,
      targetDate: null,
    });
    expect(result.contributedCents).toBe(0);
    expect(result.remainingCents).toBe(dollars(1000));
    expect(result.progressRatio).toBe(0);
    expect(result.achieved).toBe(false);
  });

  it('is achieved once contribution meets the target exactly', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(1000),
      netContributedCents: dollars(1000),
      today: '2026-08-01' as IsoDate,
      targetDate: null,
    });
    expect(result.achieved).toBe(true);
    expect(result.remainingCents).toBe(0);
    expect(result.progressRatio).toBe(1);
  });

  it('caps the progress ratio at 1 when overfunded', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(1000),
      netContributedCents: dollars(1500),
      today: '2026-08-01' as IsoDate,
      targetDate: null,
    });
    expect(result.achieved).toBe(true);
    expect(result.remainingCents).toBe(0);
    expect(result.progressRatio).toBe(1);
  });

  it('treats a zero-cent target as already achieved', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(0),
      netContributedCents: dollars(0),
      today: '2026-08-01' as IsoDate,
      targetDate: null,
    });
    expect(result.achieved).toBe(true);
    expect(result.progressRatio).toBe(1);
  });

  it('has no monthly suggestion without a target date', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(1000),
      netContributedCents: dollars(0),
      today: '2026-08-01' as IsoDate,
      targetDate: null,
    });
    expect(result.monthsRemaining).toBeNull();
    expect(result.suggestedMonthlyCents).toBeNull();
  });

  it('has no monthly suggestion once achieved, even with a target date', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(1000),
      netContributedCents: dollars(1000),
      today: '2026-08-01' as IsoDate,
      targetDate: '2026-12-31' as IsoDate,
    });
    expect(result.suggestedMonthlyCents).toBeNull();
  });

  it('is overdue once the target date has passed without being achieved', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(1000),
      netContributedCents: dollars(400),
      today: '2026-08-15' as IsoDate,
      targetDate: '2026-08-01' as IsoDate,
    });
    expect(result.overdue).toBe(true);
    expect(result.monthsRemaining).toBeNull();
    expect(result.suggestedMonthlyCents).toBeNull();
  });

  it('is not overdue when achieved exactly on the target date passing', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(1000),
      netContributedCents: dollars(1000),
      today: '2026-08-15' as IsoDate,
      targetDate: '2026-08-01' as IsoDate,
    });
    expect(result.overdue).toBe(false);
    expect(result.achieved).toBe(true);
  });

  it('rounds the monthly suggestion UP so the final month never undershoots', () => {
    // S$100 left over 3 months -> 33.34/mo (not 33.33), so 3 months of 33.34
    // sums to 100.02, comfortably covering the 100 target.
    const result = calculateGoalProgress({
      targetCents: dollars(100),
      netContributedCents: dollars(0),
      today: '2026-08-01' as IsoDate,
      targetDate: '2026-10-31' as IsoDate,
    });
    expect(result.monthsRemaining).toBe(3);
    expect(result.suggestedMonthlyCents).toBe(centsOf(3334));
    expect(result.suggestedMonthlyCents! * result.monthsRemaining!).toBeGreaterThanOrEqual(
      dollars(100),
    );
  });

  it('suggests the exact remainder when it already divides evenly', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(300),
      netContributedCents: dollars(0),
      today: '2026-08-01' as IsoDate,
      targetDate: '2026-10-31' as IsoDate,
    });
    expect(result.monthsRemaining).toBe(3);
    expect(result.suggestedMonthlyCents).toBe(dollars(100));
  });

  it('hands the whole remainder to the last day of the target month', () => {
    const result = calculateGoalProgress({
      targetCents: dollars(500),
      netContributedCents: dollars(200),
      today: '2026-08-31' as IsoDate,
      targetDate: '2026-08-31' as IsoDate,
    });
    expect(result.monthsRemaining).toBe(1);
    expect(result.suggestedMonthlyCents).toBe(dollars(300));
  });
});

describe('monthsRemainingUntil — "today counts", same convention as recurrence/safe-to-spend', () => {
  it('counts the current month as 1 when the target date is this month', () => {
    expect(monthsRemainingUntil('2026-08-01' as IsoDate, '2026-08-31' as IsoDate)).toBe(1);
    expect(monthsRemainingUntil('2026-08-31' as IsoDate, '2026-08-31' as IsoDate)).toBe(1);
  });

  it('counts inclusively across a year boundary', () => {
    // November, December, January -> 3.
    expect(monthsRemainingUntil('2026-11-15' as IsoDate, '2027-01-01' as IsoDate)).toBe(3);
  });

  it('returns 0 for a target date that has already passed', () => {
    expect(monthsRemainingUntil('2026-08-15' as IsoDate, '2026-08-01' as IsoDate)).toBe(0);
    expect(monthsRemainingUntil('2026-09-01' as IsoDate, '2026-08-31' as IsoDate)).toBe(0);
  });
});
