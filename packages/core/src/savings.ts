/**
 * Savings goals — tracked separately from safe-to-spend (PRD-adjacent).
 *
 * A goal is funded by tagging a transfer transaction to it, so contributing
 * never touches the monthly budget (F6.7 already excludes transfers). Net
 * contribution, not a running total: a transaction tagged to a goal with
 * direction `in` withdraws from it, so correcting a mistake or pulling money
 * back out needs no separate mechanism.
 *
 * GUARDRAILS.md section 2: integer cents throughout. The one deliberate
 * asymmetry with safe-to-spend — division here rounds UP, not down. Safe-to-
 * spend rounds down so you can never be told to overspend; a savings
 * suggestion that rounded down would quietly undershoot the target on the
 * final month, which is the one failure mode a savings goal exists to avoid.
 */

import { clampNonNegative, subtractCents, type AmountCents } from './money.js';
import { compareIsoDate, parseIsoDate, type IsoDate } from './time.js';

export interface SavingsGoalProgressInput {
  targetCents: AmountCents;
  /** out-tagged minus in-tagged, from the repository aggregate. Can be negative. */
  netContributedCents: number;
  today: IsoDate;
  targetDate: IsoDate | null;
}

export interface SavingsGoalProgress {
  targetCents: AmountCents;
  /** Never negative — a net-negative contribution history reads as 0 progress. */
  contributedCents: AmountCents;
  remainingCents: AmountCents;
  achieved: boolean;
  /** Target date has passed and the goal is not yet achieved. */
  overdue: boolean;
  /** Inclusive of the current month. Null with no target date, or once overdue. */
  monthsRemaining: number | null;
  /** Rounds up — see the file header. Null wherever monthsRemaining is null, or once achieved. */
  suggestedMonthlyCents: AmountCents | null;
  /** 0-1, clamped, for a progress bar. */
  progressRatio: number;
}

/** Months from `today` to `targetDate`, inclusive of the current month — "today counts". */
export function monthsRemainingUntil(today: IsoDate, targetDate: IsoDate): number {
  if (compareIsoDate(targetDate, today) < 0) return 0;
  const t = parseIsoDate(today);
  const d = parseIsoDate(targetDate);
  return (d.year - t.year) * 12 + (d.month - t.month) + 1;
}

/** Divide, rounding up. The one place this codebase rounds up — see the file header. */
function divideCentsCeil(value: AmountCents, parts: number): AmountCents {
  return Math.ceil(value / parts) as AmountCents;
}

export function calculateGoalProgress(input: SavingsGoalProgressInput): SavingsGoalProgress {
  const { targetCents, today, targetDate } = input;

  const contributedCents = clampNonNegative(input.netContributedCents as AmountCents);
  const remainingCents = clampNonNegative(subtractCents(targetCents, contributedCents));
  const achieved = remainingCents <= 0;

  const overdue = !achieved && targetDate !== null && compareIsoDate(targetDate, today) < 0;

  const monthsRemaining =
    targetDate === null || overdue ? null : monthsRemainingUntil(today, targetDate);

  const suggestedMonthlyCents =
    achieved || monthsRemaining === null ? null : divideCentsCeil(remainingCents, monthsRemaining);

  const progressRatio =
    targetCents <= 0 ? 1 : Math.min(1, Math.max(0, contributedCents / targetCents));

  return {
    targetCents,
    contributedCents,
    remainingCents,
    achieved,
    overdue,
    monthsRemaining,
    suggestedMonthlyCents,
    progressRatio,
  };
}
