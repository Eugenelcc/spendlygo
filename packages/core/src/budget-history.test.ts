/**
 * F17 Part 5 budget history, pure parts (B-032 P5-AC1, P5-AC2).
 * Written before the feature exists: these fail until budget-history.ts is built.
 */

import { describe, expect, it } from 'vitest';
import { budgetChangeEffectiveFrom, compareWithBudget } from './budget-history.js';
import { centsOf } from './money.js';
import { ValidationError } from './errors.js';
import type { IsoDate } from './time.js';

const d = (value: string) => value as IsoDate;

describe('compareWithBudget', () => {
  it('under, over, on and a $0 budget, never a negative difference', () => {
    const cases: Array<[number, number, string, number]> = [
      [35_000, 31_000, 'under', 4_000],
      [35_000, 37_500, 'over', 2_500],
      [35_000, 35_000, 'on', 0],
      [0, 0, 'on', 0],
      [0, 1_200, 'over', 1_200],
    ];
    for (const [budget, spent, status, difference] of cases) {
      const result = compareWithBudget(centsOf(budget), centsOf(spent));
      expect(result).toEqual({ status, differenceCents: difference });
      expect(result.differenceCents).toBeGreaterThanOrEqual(0);
    }

    // A negative or non-integer input is a ValidationError.
    expect(() => compareWithBudget(-1 as never, centsOf(0))).toThrow(ValidationError);
    expect(() => compareWithBudget(centsOf(100), -1 as never)).toThrow(ValidationError);
    expect(() => compareWithBudget(1.5 as never, centsOf(0))).toThrow(ValidationError);
    expect(() => compareWithBudget(centsOf(100), 0.5 as never)).toThrow(ValidationError);
  });
});

describe('budgetChangeEffectiveFrom', () => {
  it("the writer's today, never before the latest change", () => {
    expect(budgetChangeEffectiveFrom(d('2026-11-01'), null)).toBe('2026-11-01');
    expect(budgetChangeEffectiveFrom(d('2026-10-31'), d('2026-11-01'))).toBe('2026-11-01');
    expect(budgetChangeEffectiveFrom(d('2026-11-02'), d('2026-11-01'))).toBe('2026-11-02');
    expect(budgetChangeEffectiveFrom(d('2026-11-01'), d('1970-01-01'))).toBe('2026-11-01');
  });
});
