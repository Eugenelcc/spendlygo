import { describe, expect, it } from 'vitest';
import {
  nextOccurrence,
  occurrencesInRange,
  validateRecurrenceRule,
  type RecurrenceRule,
} from './recurrence.js';
import { ValidationError } from './errors.js';
import type { IsoDate } from './time.js';

const iso = (d: string) => d as IsoDate;

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    cadence: 'monthly',
    anchorDate: iso('2026-01-15'),
    dayOfMonth: 15,
    endDate: null,
    ...overrides,
  };
}

describe('nextOccurrence', () => {
  it('daily steps by one day', () => {
    const r = rule({ cadence: 'daily', anchorDate: iso('2026-08-01'), dayOfMonth: null });
    expect(nextOccurrence(r, iso('2026-08-01'))).toBe('2026-08-02');
    expect(nextOccurrence(r, iso('2026-08-27'))).toBe('2026-08-28');
  });

  it('weekly steps by seven days', () => {
    const r = rule({ cadence: 'weekly', anchorDate: iso('2026-08-06'), dayOfMonth: null });
    expect(nextOccurrence(r, iso('2026-08-06'))).toBe('2026-08-13');
    expect(nextOccurrence(r, iso('2026-08-13'))).toBe('2026-08-20');
  });

  it('monthly steps by one month, same day', () => {
    const r = rule({ anchorDate: iso('2026-01-15'), dayOfMonth: 15 });
    expect(nextOccurrence(r, iso('2026-01-15'))).toBe('2026-02-15');
    expect(nextOccurrence(r, iso('2026-02-15'))).toBe('2026-03-15');
  });

  it('yearly steps by one year, same day', () => {
    const r = rule({ cadence: 'yearly', anchorDate: iso('2026-03-10'), dayOfMonth: 10 });
    expect(nextOccurrence(r, iso('2026-03-10'))).toBe('2027-03-10');
  });

  it('PRD F5.2: clamps to the last day of a shorter month', () => {
    // Rent due the 31st. February has no 31st.
    const r = rule({ anchorDate: iso('2026-01-31'), dayOfMonth: 31 });
    expect(nextOccurrence(r, iso('2026-01-31'))).toBe('2026-02-28');
    expect(nextOccurrence(r, iso('2026-02-28'))).toBe('2026-03-31'); // back to 31 once March allows it
  });

  it('clamps into a leap February correctly', () => {
    const r = rule({ anchorDate: iso('2024-01-31'), dayOfMonth: 31 });
    expect(nextOccurrence(r, iso('2024-01-31'))).toBe('2024-02-29');
  });

  it('does not let clamping drift accumulate month over month', () => {
    // A rule anchored to the 30th must land on the 30th every month that has
    // one, not creep to the 28th after touching February.
    const r = rule({ anchorDate: iso('2026-01-30'), dayOfMonth: 30 });
    let date: IsoDate = '2026-01-30';
    const seen: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const next = nextOccurrence(r, date);
      if (!next) break;
      seen.push(next);
      date = next;
    }
    expect(seen).toEqual([
      '2026-02-28', // Feb has no 30th
      '2026-03-30', // back to 30 in March, not stuck at 28
      '2026-04-30',
      '2026-05-30',
      '2026-06-30',
      '2026-07-30',
    ]);
  });

  it('has no next occurrence before the anchor date has passed', () => {
    const r = rule({ anchorDate: iso('2026-08-15'), dayOfMonth: 15 });
    // "after" is before the anchor: the first occurrence IS the anchor.
    expect(nextOccurrence(r, iso('2026-08-01'))).toBe('2026-08-15');
  });

  it('returns null once endDate has passed', () => {
    const r = rule({ anchorDate: iso('2026-01-15'), dayOfMonth: 15, endDate: iso('2026-03-15') });
    expect(nextOccurrence(r, iso('2026-02-15'))).toBe('2026-03-15');
    expect(nextOccurrence(r, iso('2026-03-15'))).toBeNull();
  });

  it('resolves quickly for a rule anchored years in the past', () => {
    const r = rule({ cadence: 'daily', anchorDate: iso('2018-01-01'), dayOfMonth: null });
    const started = Date.now();
    const result = nextOccurrence(r, iso('2026-08-26'));
    expect(result).toBe('2026-08-27');
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe('occurrencesInRange — the backfill path (PRD F5.4)', () => {
  it('produces every missed daily occurrence, none skipped', () => {
    const r = rule({ cadence: 'daily', anchorDate: iso('2026-08-01'), dayOfMonth: null });
    // The service was down for 4 days; the tick resumes and must not skip any.
    const missed = occurrencesInRange(r, iso('2026-08-01'), iso('2026-08-05'));
    expect(missed).toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']);
  });

  it('produces every missed month, clamped, across a Feb boundary', () => {
    const r = rule({ anchorDate: iso('2026-01-31'), dayOfMonth: 31 });
    const missed = occurrencesInRange(r, iso('2026-01-01'), iso('2026-04-30'));
    expect(missed).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('is empty when nothing falls in the range', () => {
    const r = rule({ anchorDate: iso('2026-06-15'), dayOfMonth: 15 });
    expect(occurrencesInRange(r, iso('2026-01-01'), iso('2026-06-14'))).toEqual([]);
  });

  it('is empty for an inverted range', () => {
    const r = rule();
    expect(occurrencesInRange(r, iso('2026-08-01'), iso('2026-01-01'))).toEqual([]);
  });

  it('stops at endDate even mid-range', () => {
    const r = rule({
      cadence: 'daily',
      anchorDate: iso('2026-08-01'),
      dayOfMonth: null,
      endDate: iso('2026-08-03'),
    });
    expect(occurrencesInRange(r, iso('2026-08-01'), iso('2026-08-10'))).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('includes both range endpoints', () => {
    const r = rule({ cadence: 'weekly', anchorDate: iso('2026-08-06'), dayOfMonth: null });
    expect(occurrencesInRange(r, iso('2026-08-06'), iso('2026-08-06'))).toEqual(['2026-08-06']);
  });
});

describe('validateRecurrenceRule', () => {
  it('requires a dayOfMonth for monthly and yearly rules', () => {
    expect(() => validateRecurrenceRule(rule({ cadence: 'monthly', dayOfMonth: null }))).toThrow(
      ValidationError,
    );
    expect(() => validateRecurrenceRule(rule({ cadence: 'yearly', dayOfMonth: null }))).toThrow(
      ValidationError,
    );
  });

  it('does not require dayOfMonth for daily or weekly rules', () => {
    expect(() =>
      validateRecurrenceRule(rule({ cadence: 'daily', dayOfMonth: null })),
    ).not.toThrow();
    expect(() =>
      validateRecurrenceRule(rule({ cadence: 'weekly', dayOfMonth: null })),
    ).not.toThrow();
  });

  it('rejects an out-of-range dayOfMonth', () => {
    expect(() => validateRecurrenceRule(rule({ dayOfMonth: 0 }))).toThrow(ValidationError);
    expect(() => validateRecurrenceRule(rule({ dayOfMonth: 32 }))).toThrow(ValidationError);
  });

  it('rejects an endDate before the anchor', () => {
    expect(() =>
      validateRecurrenceRule(rule({ anchorDate: iso('2026-06-01'), endDate: iso('2026-01-01') })),
    ).toThrow(ValidationError);
  });
});
