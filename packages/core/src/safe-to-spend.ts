/**
 * The safe-to-spend engine (PRD F6) — the number the whole app exists to show.
 *
 *   remaining        = budget − spent so far this month
 *   safe to spend    = floor(remaining ÷ days left, today included)
 *
 * Overspending today shrinks tomorrow automatically; underspending grows it.
 * That self-correction is the feature, which is why there is no separate
 * rollover setting.
 *
 * GUARDRAILS.md section 2: integer cents, division rounds down, and the sum of
 * daily allowances can never exceed the budget.
 */

import {
  clampNonNegative,
  divideCentsFloor,
  scaleCentsFloor,
  subtractCents,
  ZERO_CENTS,
  type AmountCents,
} from './money.js';
import { daysInMonth, parseIsoDate, type IsoDate } from './time.js';

export type Pace = 'ahead' | 'on_track' | 'behind' | 'over_budget';

export interface SafeToSpendInput {
  /** Null until the user sets one. PRD F6.6: never invent a budget. */
  budgetCents: AmountCents | null;
  /** Month-to-date spending, excluding categories flagged excludeFromBudget. */
  spentMonthToDateCents: AmountCents;
  /** Spent today, for the "and you've used X of it" line. */
  spentTodayCents: AmountCents;
  /** Today, already resolved in the user's timezone. */
  today: IsoDate;
}

export interface SafeToSpendResult {
  hasBudget: boolean;
  budgetCents: AmountCents | null;
  spentMonthToDateCents: AmountCents;
  spentTodayCents: AmountCents;
  /** Budget minus spend. Can be negative — see `overspentCents` for the display value. */
  remainingCents: AmountCents;
  /** How much you may spend today. Never negative. */
  safeTodayCents: AmountCents;
  /** What is left of today's allowance after what you have already spent today. */
  leftForTodayCents: AmountCents;
  /** How far past the budget this month is, or zero. */
  overspentCents: AmountCents;
  /** Today counts, so this is 1 on the last day of the month. */
  daysRemaining: number;
  dayOfMonth: number;
  daysInMonth: number;
  /** What a perfectly even month would have spent by now. */
  expectedSpendCents: AmountCents;
  /** Month-end total at the current rate. */
  projectedSpendCents: AmountCents;
  pace: Pace;
  /** 0-1, clamped. For the progress bar. */
  budgetUsedRatio: number;
}

/** PRD F6.4 — ±10% of the even-pace line reads as "on track". */
const PACE_TOLERANCE = 0.1;

export function calculateSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const { budgetCents, spentMonthToDateCents, spentTodayCents, today } = input;

  const { year, month, day } = parseIsoDate(today);
  const totalDays = daysInMonth(year, month);
  const daysRemaining = totalDays - day + 1;

  if (budgetCents === null) {
    return {
      hasBudget: false,
      budgetCents: null,
      spentMonthToDateCents,
      spentTodayCents,
      remainingCents: ZERO_CENTS,
      safeTodayCents: ZERO_CENTS,
      leftForTodayCents: ZERO_CENTS,
      overspentCents: ZERO_CENTS,
      daysRemaining,
      dayOfMonth: day,
      daysInMonth: totalDays,
      expectedSpendCents: ZERO_CENTS,
      projectedSpendCents: projectSpend(spentMonthToDateCents, day, totalDays),
      pace: 'on_track',
      budgetUsedRatio: 0,
    };
  }

  const remainingCents = subtractCents(budgetCents, spentMonthToDateCents);

  // PRD F6.3: a negative remainder reads as zero allowance, not a negative one.
  const safeTodayCents = divideCentsFloor(clampNonNegative(remainingCents), daysRemaining);

  // What is left of today specifically. Today's spend already sits inside
  // spentMonthToDate, so add it back before subtracting — otherwise it counts twice.
  const leftForTodayCents = clampNonNegative(subtractCents(safeTodayCents, spentTodayCents));

  const overspentCents =
    remainingCents < 0 ? clampNonNegative(-remainingCents as AmountCents) : ZERO_CENTS;

  const expectedSpendCents = scaleCentsFloor(budgetCents, day / totalDays);
  const projectedSpendCents = projectSpend(spentMonthToDateCents, day, totalDays);

  return {
    hasBudget: true,
    budgetCents,
    spentMonthToDateCents,
    spentTodayCents,
    remainingCents,
    safeTodayCents,
    leftForTodayCents,
    overspentCents,
    daysRemaining,
    dayOfMonth: day,
    daysInMonth: totalDays,
    expectedSpendCents,
    projectedSpendCents,
    pace: derivePace(spentMonthToDateCents, expectedSpendCents, remainingCents),
    budgetUsedRatio:
      budgetCents === 0 ? 1 : Math.min(1, Math.max(0, spentMonthToDateCents / budgetCents)),
  };
}

function projectSpend(
  spentMonthToDateCents: AmountCents,
  dayOfMonth: number,
  totalDays: number,
): AmountCents {
  return scaleCentsFloor(spentMonthToDateCents, totalDays / dayOfMonth);
}

function derivePace(
  spentMonthToDateCents: AmountCents,
  expectedSpendCents: AmountCents,
  remainingCents: AmountCents,
): Pace {
  if (remainingCents < 0) return 'over_budget';
  if (spentMonthToDateCents < expectedSpendCents * (1 - PACE_TOLERANCE)) return 'ahead';
  if (spentMonthToDateCents > expectedSpendCents * (1 + PACE_TOLERANCE)) return 'behind';
  return 'on_track';
}

/**
 * Suggest a monthly budget from recent spending (PRD F6.6).
 *
 * Rounded down to a round hundred so the number reads like a decision rather
 * than an average, and never suggested from fewer than two weeks of data.
 */
export function suggestBudgetFromHistory(
  totalSpentCents: AmountCents,
  daysObserved: number,
): AmountCents | null {
  if (daysObserved < 14 || totalSpentCents <= 0) return null;
  const perDay = totalSpentCents / daysObserved;
  const monthly = Math.floor((perDay * 30) / 10_000) * 10_000;
  return monthly > 0 ? (monthly as AmountCents) : null;
}
