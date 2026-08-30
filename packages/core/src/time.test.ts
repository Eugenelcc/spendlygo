import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  calendarDateOf,
  clampDayOfMonth,
  compareIsoDate,
  daysBetween,
  daysInMonth,
  hourOf,
  isIsoDate,
  isoDateOf,
  isoWeekday,
  isValidTimeZone,
  monthRange,
  parseIsoDate,
  startOfDayInstant,
  toIsoDate,
  yearRange,
  type IsoDate,
} from './time.js';
import { ValidationError } from './errors.js';

const SGT = 'Asia/Singapore';

describe('timezone-aware calendar dates', () => {
  it('GUARDRAILS section 9: a late-night purchase belongs to the local day', () => {
    // 2026-08-27 16:30 UTC is 2026-08-28 00:30 in Singapore.
    const instant = new Date('2026-08-27T16:30:00Z');
    expect(isoDateOf(instant, SGT)).toBe('2026-08-28');
    expect(isoDateOf(instant, 'UTC')).toBe('2026-08-27');
  });

  it('resolves the day before the local rollover', () => {
    const instant = new Date('2026-08-27T15:30:00Z'); // 23:30 SGT
    expect(isoDateOf(instant, SGT)).toBe('2026-08-27');
  });

  it('handles a zone behind UTC', () => {
    const instant = new Date('2026-08-27T03:00:00Z'); // 2026-08-26 23:00 EDT
    expect(isoDateOf(instant, 'America/New_York')).toBe('2026-08-26');
  });

  it('returns 1-indexed months, not the JavaScript 0-11 convention', () => {
    expect(calendarDateOf(new Date('2026-01-15T04:00:00Z'), SGT)).toEqual({
      year: 2026,
      month: 1,
      day: 15,
    });
  });

  it('rejects an unknown timezone', () => {
    expect(isValidTimeZone(SGT)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(() => isoDateOf(new Date(), 'Mars/Olympus_Mons')).toThrow(ValidationError);
  });
});

describe('hourOf', () => {
  it('reads the local hour, and renders midnight as 0 rather than 24', () => {
    expect(hourOf(new Date('2026-08-27T13:00:00Z'), SGT)).toBe(21);
    expect(hourOf(new Date('2026-08-27T16:00:00Z'), SGT)).toBe(0);
  });
});

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2024, 2, 29],
    [2000, 2, 29],
    [1900, 2, 28],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i has %i days', (year, month, expected) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });

  it('rejects an out-of-range month', () => {
    expect(() => daysInMonth(2026, 0)).toThrow(ValidationError);
    expect(() => daysInMonth(2026, 13)).toThrow(ValidationError);
  });
});

describe('clampDayOfMonth', () => {
  it('PRD F5.2: a rule anchored to the 31st fires on the last day of short months', () => {
    expect(clampDayOfMonth(2026, 2, 31)).toBe(28);
    expect(clampDayOfMonth(2024, 2, 31)).toBe(29);
    expect(clampDayOfMonth(2026, 4, 31)).toBe(30);
    expect(clampDayOfMonth(2026, 1, 31)).toBe(31);
    expect(clampDayOfMonth(2026, 3, 15)).toBe(15);
  });
});

describe('parseIsoDate', () => {
  it('round-trips', () => {
    expect(toIsoDate(parseIsoDate('2026-08-27'))).toBe('2026-08-27');
  });

  it.each(['2026-8-27', '27/08/2026', '2026-13-01', '2026-02-30', 'today', ''])(
    'rejects %j',
    (input) => {
      expect(() => parseIsoDate(input)).toThrow(ValidationError);
      expect(isIsoDate(input)).toBe(false);
    },
  );

  it('accepts 29 February in a leap year but not otherwise', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
  });
});

describe('date arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-08-27' as IsoDate, 1)).toBe('2026-08-28');
    expect(addDays('2026-08-31' as IsoDate, 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31' as IsoDate, 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01' as IsoDate, -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28' as IsoDate, 1)).toBe('2024-02-29');
  });

  it('adds months, clamping the day', () => {
    expect(addMonths('2026-01-31' as IsoDate, 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15' as IsoDate, 1)).toBe('2026-02-15');
    expect(addMonths('2026-12-15' as IsoDate, 1)).toBe('2027-01-15');
    expect(addMonths('2026-03-31' as IsoDate, -1)).toBe('2026-02-28');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-08-01' as IsoDate, '2026-08-27' as IsoDate)).toBe(26);
    expect(daysBetween('2026-08-27' as IsoDate, '2026-08-01' as IsoDate)).toBe(-26);
    expect(daysBetween('2026-08-27' as IsoDate, '2026-08-27' as IsoDate)).toBe(0);
    expect(daysBetween('2024-02-28' as IsoDate, '2024-03-01' as IsoDate)).toBe(2);
  });

  it('compares dates lexicographically, which ISO format makes safe', () => {
    expect(compareIsoDate('2026-08-01' as IsoDate, '2026-08-27' as IsoDate)).toBe(-1);
    expect(compareIsoDate('2026-08-27' as IsoDate, '2026-08-01' as IsoDate)).toBe(1);
    expect(compareIsoDate('2026-08-27' as IsoDate, '2026-08-27' as IsoDate)).toBe(0);
  });

  it('reports ISO weekdays with Sunday as 7', () => {
    expect(isoWeekday('2026-08-27' as IsoDate)).toBe(4); // Thursday
    expect(isoWeekday('2026-08-30' as IsoDate)).toBe(7); // Sunday
    expect(isoWeekday('2026-08-31' as IsoDate)).toBe(1); // Monday
  });
});

describe('ranges', () => {
  it('bounds a month inclusively', () => {
    expect(monthRange(2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange(2024, 2)).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(monthRange(2026, 8)).toEqual({ start: '2026-08-01', end: '2026-08-31' });
  });

  it('bounds a year inclusively', () => {
    expect(yearRange(2026)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });
});

describe('startOfDayInstant', () => {
  it('resolves local midnight to the right UTC instant', () => {
    expect(startOfDayInstant('2026-08-27' as IsoDate, SGT).toISOString()).toBe(
      '2026-08-26T16:00:00.000Z',
    );
    expect(startOfDayInstant('2026-08-27' as IsoDate, 'UTC').toISOString()).toBe(
      '2026-08-27T00:00:00.000Z',
    );
  });

  it('stays correct across a DST transition', () => {
    // US DST began 2026-03-08; New York is UTC-5 before and UTC-4 after.
    expect(startOfDayInstant('2026-03-07' as IsoDate, 'America/New_York').toISOString()).toBe(
      '2026-03-07T05:00:00.000Z',
    );
    expect(startOfDayInstant('2026-03-09' as IsoDate, 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });
});
