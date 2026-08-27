import { describe, expect, it } from 'vitest';
import {
  addCents,
  centsOf,
  centsToDecimalString,
  clampNonNegative,
  divideCentsFloor,
  formatCents,
  parseAmountToCents,
  positiveCentsOf,
  scaleCentsFloor,
  subtractCents,
  sumCents,
  ZERO_CENTS,
} from './money.js';
import { ValidationError } from './errors.js';

describe('centsOf', () => {
  it('accepts whole numbers, including negatives for computed deltas', () => {
    expect(centsOf(0)).toBe(0);
    expect(centsOf(1234)).toBe(1234);
    expect(centsOf(-500)).toBe(-500);
  });

  it('rejects fractional cents — the float bug this whole module exists to prevent', () => {
    expect(() => centsOf(12.5)).toThrow(ValidationError);
    expect(() => centsOf(0.1 + 0.2)).toThrow(ValidationError);
    expect(() => centsOf(NaN)).toThrow(ValidationError);
    expect(() => centsOf(Infinity)).toThrow(ValidationError);
  });
});

describe('positiveCentsOf', () => {
  it('requires a strictly positive amount', () => {
    expect(positiveCentsOf(1)).toBe(1);
    expect(() => positiveCentsOf(0)).toThrow(ValidationError);
    expect(() => positiveCentsOf(-1)).toThrow(ValidationError);
  });

  it('rejects implausibly large amounts as a typo guard', () => {
    expect(() => positiveCentsOf(1_000_000_001)).toThrow(ValidationError);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts and sums', () => {
    expect(addCents(centsOf(1250), centsOf(230))).toBe(1480);
    expect(subtractCents(centsOf(1250), centsOf(230))).toBe(1020);
    expect(sumCents([centsOf(100), centsOf(250), centsOf(3)])).toBe(353);
    expect(sumCents([])).toBe(0);
  });

  it('clamps negatives to zero for "nothing left" states', () => {
    expect(clampNonNegative(centsOf(-4200))).toBe(ZERO_CENTS);
    expect(clampNonNegative(centsOf(4200))).toBe(4200);
  });
});

describe('divideCentsFloor', () => {
  it('always rounds down', () => {
    expect(divideCentsFloor(centsOf(1000), 3)).toBe(333);
    expect(divideCentsFloor(centsOf(999), 10)).toBe(99);
    expect(divideCentsFloor(centsOf(1), 2)).toBe(0);
  });

  it('GUARDRAILS section 2: daily allowances can never sum above the budget', () => {
    // The safe-to-spend loop: each day divides what remains by the days left.
    for (const budget of [10_000, 99_999, 150_000, 7, 1]) {
      for (const days of [28, 29, 30, 31]) {
        let remaining = centsOf(budget);
        let handedOut = 0;
        for (let left = days; left > 0; left -= 1) {
          const allowance = divideCentsFloor(clampNonNegative(remaining), left);
          handedOut += allowance;
          remaining = subtractCents(remaining, allowance);
        }
        expect(handedOut).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('rejects a non-positive divisor', () => {
    expect(() => divideCentsFloor(centsOf(100), 0)).toThrow(ValidationError);
    expect(() => divideCentsFloor(centsOf(100), -1)).toThrow(ValidationError);
    expect(() => divideCentsFloor(centsOf(100), 1.5)).toThrow(ValidationError);
  });
});

describe('scaleCentsFloor', () => {
  it('scales by a ratio and rounds down', () => {
    expect(scaleCentsFloor(centsOf(150_000), 27 / 31)).toBe(130_645);
    expect(scaleCentsFloor(centsOf(100), 0)).toBe(0);
  });
});

describe('formatCents', () => {
  const strip = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

  it('formats SGD with grouped thousands and two decimals', () => {
    expect(strip(formatCents(centsOf(123_456)))).toBe('$1,234.56');
    expect(strip(formatCents(centsOf(0)))).toBe('$0.00');
    expect(strip(formatCents(centsOf(5)))).toBe('$0.05');
  });

  it('renders negatives with a leading minus, not parentheses', () => {
    expect(strip(formatCents(centsOf(-1250)))).toBe('-$12.50');
  });

  it('can hide zero cents and mark income with a sign', () => {
    expect(strip(formatCents(centsOf(150_000), { hideZeroCents: true }))).toBe('$1,500');
    expect(strip(formatCents(centsOf(150_050), { hideZeroCents: true }))).toBe('$1,500.50');
    expect(strip(formatCents(centsOf(300_000), { signed: true }))).toBe('+$3,000.00');
  });
});

describe('centsToDecimalString', () => {
  it('produces bare decimals for CSV export', () => {
    expect(centsToDecimalString(centsOf(1234))).toBe('12.34');
    expect(centsToDecimalString(centsOf(5))).toBe('0.05');
    expect(centsToDecimalString(centsOf(150_000))).toBe('1500.00');
    expect(centsToDecimalString(centsOf(-1234))).toBe('-12.34');
  });
});

describe('parseAmountToCents', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['0.05', 5],
    ['.5', 50],
    ['1234.56', 123_456],
    ['1,234.56', 123_456],
    ['S$12.50', 1250],
    ['s$12.50', 1250],
    ['$12.50', 1250],
    ['SGD 12.50', 1250],
    ['12.5k', 12_500_00],
    ['1k', 100_000],
    ['3K', 300_000],
    ['  12.50  ', 1250],
  ])('parses %j as %i cents', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it.each([
    [''],
    ['lunch'],
    ['abc'],
    ['12.345'],
    ['0'],
    ['0.00'],
    ['-5'],
    ['1.2.3'],
    ['12k5'],
    ['99999999999'],
  ])('returns null for %j', (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });
});
