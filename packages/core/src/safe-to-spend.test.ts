import { describe, expect, it } from 'vitest';
import { calculateSafeToSpend, suggestBudgetFromHistory } from './safe-to-spend.js';
import { centsOf } from './money.js';
import type { IsoDate } from './time.js';

// Math.round, because `999.99 * 100` is 99998.99999999999 in binary floating
// point — the very bug this module exists to prevent, and it bit the helper.
const budget = (dollars: number) => centsOf(Math.round(dollars * 100));

function calc(opts: {
  budget: number | null;
  spentMtd: number;
  spentToday?: number;
  today: string;
}) {
  return calculateSafeToSpend({
    budgetCents: opts.budget === null ? null : budget(opts.budget),
    spentMonthToDateCents: budget(opts.spentMtd),
    spentTodayCents: budget(opts.spentToday ?? 0),
    today: opts.today as IsoDate,
  });
}

describe('the core formula', () => {
  it('splits the budget across the days left, today included', () => {
    // 1 August, S$1,500 budget, nothing spent: 1500 / 31 days.
    const result = calc({ budget: 1500, spentMtd: 0, today: '2026-08-01' });
    expect(result.daysRemaining).toBe(31);
    expect(result.safeTodayCents).toBe(4838); // floor(150000 / 31)
  });

  it('counts today, so the last day of the month gets the whole remainder', () => {
    const result = calc({ budget: 1500, spentMtd: 1400, today: '2026-08-31' });
    expect(result.daysRemaining).toBe(1);
    expect(result.safeTodayCents).toBe(budget(100));
  });

  it('shrinks tomorrow when you overspend today — the whole point', () => {
    const onPace = calc({ budget: 3100, spentMtd: 100, today: '2026-08-02' });
    const overspent = calc({ budget: 3100, spentMtd: 500, today: '2026-08-02' });
    expect(overspent.safeTodayCents).toBeLessThan(onPace.safeTodayCents);
  });

  it('grows tomorrow when you underspend', () => {
    const spentNothing = calc({ budget: 3100, spentMtd: 0, today: '2026-08-02' });
    const spentSome = calc({ budget: 3100, spentMtd: 100, today: '2026-08-02' });
    expect(spentNothing.safeTodayCents).toBeGreaterThan(spentSome.safeTodayCents);
  });
});

describe('going over budget (PRD F6.3)', () => {
  it('never reports a negative allowance', () => {
    const result = calc({ budget: 1000, spentMtd: 1200, today: '2026-08-15' });
    expect(result.safeTodayCents).toBe(0);
    expect(result.remainingCents).toBe(budget(-200));
    expect(result.overspentCents).toBe(budget(200));
    expect(result.pace).toBe('over_budget');
  });

  it('reports zero overspend while still inside the budget', () => {
    expect(calc({ budget: 1000, spentMtd: 900, today: '2026-08-15' }).overspentCents).toBe(0);
  });
});

describe("what's left of today", () => {
  it('subtracts what today has already used', () => {
    const result = calc({ budget: 3100, spentMtd: 20, spentToday: 20, today: '2026-08-01' });
    // 3100/31 = 100 a day, 20 already spent today.
    expect(result.safeTodayCents).toBe(budget(99.35));
    expect(result.leftForTodayCents).toBe(budget(79.35));
  });

  it('floors at zero once today is spent out', () => {
    const result = calc({ budget: 3100, spentMtd: 500, spentToday: 500, today: '2026-08-01' });
    expect(result.leftForTodayCents).toBe(0);
  });
});

describe('pace (PRD F6.4)', () => {
  // On 15 August, 15 of 31 days have passed — 48.4%, not half. So a S$1,000
  // budget expects S$483.87 by now, and the on-track band is +/-10% of that:
  // S$435.48 to S$532.26.
  const EXPECTED = Math.floor(((1000 * 15) / 31) * 100);

  it.each([
    [300, 'ahead'],
    [435, 'ahead'], // just under the band
    [436, 'on_track'],
    [483.87, 'on_track'], // exactly on pace
    [532, 'on_track'], // just inside the top of the band
    [533, 'behind'],
    [700, 'behind'],
    [1200, 'over_budget'], // past the budget entirely, whatever the pace says
  ])('spent S$%s -> %s', (spent, expected) => {
    const result = calculateSafeToSpend({
      budgetCents: budget(1000),
      spentMonthToDateCents: budget(spent),
      spentTodayCents: centsOf(0),
      today: '2026-08-15' as IsoDate,
    });
    expect(result.expectedSpendCents).toBe(EXPECTED);
    expect(result.pace).toBe(expected);
  });

  it('reports over_budget ahead of any other verdict', () => {
    // Spending the entire budget on day 1 is "behind" on pace and over budget;
    // over budget is the more useful thing to say.
    const result = calculateSafeToSpend({
      budgetCents: budget(1000),
      spentMonthToDateCents: budget(1001),
      spentTodayCents: centsOf(0),
      today: '2026-08-01' as IsoDate,
    });
    expect(result.pace).toBe('over_budget');
  });
});

describe('no budget set (PRD F6.6)', () => {
  it('reports honestly rather than inventing a number', () => {
    const result = calc({ budget: null, spentMtd: 250, today: '2026-08-15' });
    expect(result.hasBudget).toBe(false);
    expect(result.budgetCents).toBeNull();
    expect(result.safeTodayCents).toBe(0);
    expect(result.budgetUsedRatio).toBe(0);
  });

  it('still projects the month, which is useful without a budget', () => {
    const result = calc({ budget: null, spentMtd: 150, today: '2026-08-15' });
    expect(result.projectedSpendCents).toBe(Math.floor(((150 * 31) / 15) * 100));
  });
});

describe('month lengths', () => {
  it.each([
    ['2026-02-01', 28],
    ['2024-02-01', 29],
    ['2026-04-01', 30],
    ['2026-12-01', 31],
  ])('%s has %i days', (today, days) => {
    expect(calc({ budget: 1000, spentMtd: 0, today }).daysInMonth).toBe(days);
  });
});

describe('GUARDRAILS section 2 — allowances can never overspend the budget', () => {
  it.each([100, 999.99, 1500, 0.07, 12345.67])(
    'holds for a S$%s budget across a whole month',
    (budgetDollars) => {
      for (const [year, month, days] of [
        [2026, 2, 28],
        [2024, 2, 29],
        [2026, 4, 30],
        [2026, 8, 31],
      ] as const) {
        let spent = 0;
        let handedOut = 0;

        for (let day = 1; day <= days; day += 1) {
          const today = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const result = calculateSafeToSpend({
            budgetCents: budget(budgetDollars),
            spentMonthToDateCents: centsOf(spent),
            spentTodayCents: centsOf(0),
            today: today as IsoDate,
          });
          handedOut += result.safeTodayCents;
          // Spend every cent offered — the worst case for the invariant.
          spent += result.safeTodayCents;
        }

        expect(handedOut).toBeLessThanOrEqual(budget(budgetDollars));
      }
    },
  );

  it('never returns a fractional cent', () => {
    for (let day = 1; day <= 31; day += 1) {
      const today = `2026-08-${String(day).padStart(2, '0')}`;
      const result = calc({ budget: 999.99, spentMtd: day * 7.77, today });
      expect(Number.isInteger(result.safeTodayCents)).toBe(true);
      expect(Number.isInteger(result.leftForTodayCents)).toBe(true);
    }
  });
});

describe('suggestBudgetFromHistory', () => {
  it('rounds down to a round hundred, so it reads like a decision', () => {
    // S$900 over 30 days -> S$900/month -> rounded to 900.
    expect(suggestBudgetFromHistory(budget(900), 30)).toBe(budget(900));
    expect(suggestBudgetFromHistory(budget(947), 30)).toBe(budget(900));
  });

  it('declines to suggest from too little history', () => {
    expect(suggestBudgetFromHistory(budget(500), 13)).toBeNull();
    expect(suggestBudgetFromHistory(centsOf(0), 60)).toBeNull();
  });
});
