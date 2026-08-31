import { describe, expect, it } from 'vitest';
import { calculateStreak } from './streaks.js';
import type { IsoDate } from './time.js';

const d = (s: string) => s as IsoDate;

describe('calculateStreak', () => {
  it('is zero/zero with no history', () => {
    expect(calculateStreak([], d('2026-08-15'))).toEqual({ current: 0, longest: 0 });
  });

  it('is 1 for a single day logged today', () => {
    expect(calculateStreak([d('2026-08-15')], d('2026-08-15'))).toEqual({
      current: 1,
      longest: 1,
    });
  });

  it('counts consecutive days ending today', () => {
    const dates = [d('2026-08-13'), d('2026-08-14'), d('2026-08-15')];
    expect(calculateStreak(dates, d('2026-08-15'))).toEqual({ current: 3, longest: 3 });
  });

  it('keeps the current streak alive through today, if yesterday was the last logged day', () => {
    const dates = [d('2026-08-13'), d('2026-08-14')];
    expect(calculateStreak(dates, d('2026-08-15'))).toEqual({ current: 2, longest: 2 });
  });

  it('breaks the current streak once a day is skipped entirely', () => {
    const dates = [d('2026-08-10'), d('2026-08-11'), d('2026-08-12')];
    // Nothing logged on the 13th, 14th, or today (15th) — two full days skipped.
    expect(calculateStreak(dates, d('2026-08-15'))).toEqual({ current: 0, longest: 3 });
  });

  it('is unaffected by input order or duplicates', () => {
    const dates = [d('2026-08-15'), d('2026-08-13'), d('2026-08-14'), d('2026-08-14')];
    expect(calculateStreak(dates, d('2026-08-15'))).toEqual({ current: 3, longest: 3 });
  });

  it('reports the longest run even when the current streak is broken', () => {
    const dates = [
      d('2026-08-01'),
      d('2026-08-02'),
      d('2026-08-03'),
      d('2026-08-04'),
      d('2026-08-05'),
      // gap
      d('2026-08-10'),
    ];
    expect(calculateStreak(dates, d('2026-08-15'))).toEqual({ current: 0, longest: 5 });
  });

  it('crosses a month boundary correctly', () => {
    const dates = [d('2026-07-30'), d('2026-07-31'), d('2026-08-01'), d('2026-08-02')];
    expect(calculateStreak(dates, d('2026-08-02'))).toEqual({ current: 4, longest: 4 });
  });

  it('crosses a leap-February boundary correctly', () => {
    const dates = [d('2024-02-28'), d('2024-02-29'), d('2024-03-01')];
    expect(calculateStreak(dates, d('2024-03-01'))).toEqual({ current: 3, longest: 3 });
  });

  it('a single logged day older than yesterday has no current streak', () => {
    expect(calculateStreak([d('2026-08-01')], d('2026-08-15'))).toEqual({
      current: 0,
      longest: 1,
    });
  });
});
