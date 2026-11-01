/**
 * F17 budget cycle boundaries (B-032 Part 1, P1-AC1 to AC10).
 * Written before the feature exists: these fail until cycle.ts is built.
 */

import { describe, expect, it } from 'vitest';
import {
  cycleAlertKey,
  cycleContaining,
  formatCycleRange,
  formatDateRangeWithYears,
  nextCycle,
  ordinalDay,
  previousCycle,
  type BudgetCycle,
} from './cycle.js';
import { ValidationError } from './errors.js';
import {
  addDays,
  daysBetween,
  daysInMonth,
  isoDateOf,
  monthRange,
  parseIsoDate,
  type IsoDate,
} from './time.js';

const d = (value: string) => value as IsoDate;

function expectCycle(date: string, startDay: number, start: string, end: string, days: number) {
  const cycle = cycleContaining(d(date), startDay);
  expect({
    start: cycle.start,
    end: cycle.end,
    days: cycle.days,
    startDay: cycle.startDay,
  }).toEqual({ start, end, days, startDay });
}

describe('cycleContaining', () => {
  it('start day 1 is exactly the calendar month for every date 2024–2028', () => {
    let date = d('2024-01-01');
    while (date <= '2028-12-31') {
      const { year, month } = parseIsoDate(date);
      const cycle = cycleContaining(date, 1);
      const expected = monthRange(year, month);
      expect(cycle.start).toBe(expected.start);
      expect(cycle.end).toBe(expected.end);
      expect(cycle.days).toBe(daysInMonth(year, month));
      date = addDays(date, 1);
    }
  });

  it('day 20: 31 Oct, first day and last day are in 20 Oct – 19 Nov; 19 Oct is in the previous cycle', () => {
    expectCycle('2026-10-31', 20, '2026-10-20', '2026-11-19', 31);
    expectCycle('2026-10-20', 20, '2026-10-20', '2026-11-19', 31);
    expectCycle('2026-11-19', 20, '2026-10-20', '2026-11-19', 31);
    expectCycle('2026-10-19', 20, '2026-09-20', '2026-10-19', 30);
  });

  it('days 29–31 clamp to 28 Feb in a common year', () => {
    expectCycle('2026-02-27', 29, '2026-01-29', '2026-02-27', 30);
    expectCycle('2026-02-28', 29, '2026-02-28', '2026-03-28', 29);
    expectCycle('2026-02-27', 30, '2026-01-30', '2026-02-27', 29);
    expectCycle('2026-02-28', 30, '2026-02-28', '2026-03-29', 30);
    expectCycle('2026-02-27', 31, '2026-01-31', '2026-02-27', 28);
    expectCycle('2026-02-28', 31, '2026-02-28', '2026-03-30', 31);
  });

  it('days 29–31 and 20 in leap February 2028', () => {
    expectCycle('2028-02-28', 29, '2028-01-29', '2028-02-28', 31);
    expectCycle('2028-02-29', 29, '2028-02-29', '2028-03-28', 29);
    expectCycle('2028-02-28', 30, '2028-01-30', '2028-02-28', 30);
    expectCycle('2028-02-29', 30, '2028-02-29', '2028-03-29', 30);
    expectCycle('2028-02-28', 31, '2028-01-31', '2028-02-28', 29);
    expectCycle('2028-02-29', 31, '2028-02-29', '2028-03-30', 31);
    expectCycle('2028-02-20', 20, '2028-02-20', '2028-03-19', 29);
  });

  it('day 31 starts on the 30th in 30-day months', () => {
    expectCycle('2026-04-30', 31, '2026-04-30', '2026-05-30', 31);
    expectCycle('2026-06-30', 31, '2026-06-30', '2026-07-30', 31);
    expectCycle('2026-09-30', 31, '2026-09-30', '2026-10-30', 31);
    expectCycle('2026-11-30', 31, '2026-11-30', '2026-12-30', 31);
    expectCycle('2026-04-29', 31, '2026-03-31', '2026-04-29', 30);
  });

  it('a day-20 cycle spans the new year', () => {
    expectCycle('2026-12-25', 20, '2026-12-20', '2027-01-19', 31);
    expectCycle('2027-01-05', 20, '2026-12-20', '2027-01-19', 31);
  });

  it('cycles tile with no gaps or overlaps for every start day 1–31', () => {
    for (let startDay = 1; startDay <= 31; startDay += 1) {
      let cycle: BudgetCycle = cycleContaining(d('2024-01-01'), startDay);
      let guard = 0;
      while (cycle.end <= '2028-12-31') {
        expect(cycle.days).toBe(daysBetween(cycle.start, cycle.end) + 1);
        const next = nextCycle(cycle);
        expect(next.start).toBe(addDays(cycle.end, 1));
        expect(previousCycle(next)).toEqual(cycle);
        cycle = next;
        guard += 1;
        expect(guard).toBeLessThan(100);
      }
    }
  });

  it('rejects a start day outside 1–31 or not an integer', () => {
    for (const bad of [0, 32, 1.5, Number.NaN, -3]) {
      expect(() => cycleContaining(d('2026-10-31'), bad)).toThrow(ValidationError);
    }
  });

  it('GUARDRAILS §9: 00:30 on the start day belongs to the new cycle', () => {
    // 00:30 on 20 Oct in Singapore is still 19 Oct in UTC.
    const instant = new Date('2026-10-19T16:30:00Z');
    const cycle = cycleContaining(isoDateOf(instant, 'Asia/Singapore'), 20);
    expect(cycle.start).toBe('2026-10-20');
    expect(cycle.end).toBe('2026-11-19');
  });
});

describe('formatCycleRange', () => {
  it('formats a cycle as "20 Oct – 19 Nov", with no year', () => {
    expect(formatCycleRange(cycleContaining(d('2026-10-31'), 20))).toBe('20 Oct – 19 Nov');
    expect(formatCycleRange(cycleContaining(d('2027-01-05'), 20))).toBe('20 Dec – 19 Jan');
  });
});

describe('formatDateRangeWithYears (B-032 Part 3)', () => {
  it('is as formatCycleRange within one year, and carries both years across New Year', () => {
    const oct = cycleContaining(d('2026-10-31'), 20);
    expect(formatDateRangeWithYears(oct)).toBe(formatCycleRange(oct));
    expect(formatDateRangeWithYears(oct)).toBe('20 Oct – 19 Nov');
    expect(formatDateRangeWithYears(cycleContaining(d('2027-01-05'), 20))).toBe(
      '20 Dec 2026 – 19 Jan 2027',
    );
  });
});

describe('cycleAlertKey (B-032 Part 2, Q2 A)', () => {
  it('is the calendar month the cycle ends in', () => {
    // Day 1: equals the calendar month, so rows written before B-032 still match.
    expect(cycleAlertKey(cycleContaining(d('2026-10-15'), 1))).toEqual({ year: 2026, month: 10 });
    // Day 20: 20 Oct - 19 Nov ends in November.
    expect(cycleAlertKey(cycleContaining(d('2026-10-31'), 20))).toEqual({ year: 2026, month: 11 });
    // Across the new year: 20 Dec - 19 Jan ends in January of the next year.
    expect(cycleAlertKey(cycleContaining(d('2026-12-25'), 20))).toEqual({ year: 2027, month: 1 });
  });

  it('gives distinct keys to 36 consecutive cycles, for every start day', () => {
    for (let startDay = 1; startDay <= 31; startDay += 1) {
      let cycle = cycleContaining(d('2026-01-15'), startDay);
      const seen = new Set<string>();
      for (let index = 0; index < 36; index += 1) {
        const { year, month } = cycleAlertKey(cycle);
        seen.add(`${year}-${month}`);
        cycle = nextCycle(cycle);
      }
      expect(seen.size).toBe(36);
    }
  });
});

describe('ordinalDay (B-032 Part 4)', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [20, '20th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [30, '30th'],
    [31, '31st'],
  ])('%i is %s', (day, expected) => {
    expect(ordinalDay(day)).toBe(expected);
  });
});
