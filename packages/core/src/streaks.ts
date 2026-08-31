/**
 * Logging streaks — a habit nudge, not a money calculation.
 *
 * Ties directly to the PRD's own success metric (days per week with >=1
 * logged transaction, PRD section 4). "Logged" means any transaction, income
 * or expense, on that calendar day in the user's timezone — the same
 * `occurred_on` every other period boundary in this codebase uses
 * (GUARDRAILS.md section 9).
 *
 * A streak is "today counts, and it isn't broken until a day is skipped
 * entirely" — so logging late at night still keeps yesterday's streak alive
 * today, and the current streak survives right up until today ends with
 * nothing logged.
 */

import { addDays, compareIsoDate, type IsoDate } from './time.js';

export interface StreakResult {
  /** Consecutive days ending today or yesterday. 0 once a day has been skipped. */
  current: number;
  /** The longest run found anywhere in `loggedDates`. */
  longest: number;
}

/**
 * `loggedDates` need not be sorted or deduplicated — every caller's source is
 * a DISTINCT query already, but this stays correct without that guarantee.
 */
export function calculateStreak(loggedDates: readonly IsoDate[], today: IsoDate): StreakResult {
  const distinct = Array.from(new Set(loggedDates)).sort(compareIsoDate);

  if (distinct.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < distinct.length; i += 1) {
    const prev = distinct[i - 1] as IsoDate;
    const day = distinct[i] as IsoDate;
    run = day === addDays(prev, 1) ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const latest = distinct[distinct.length - 1] as IsoDate;
  // Skipping today doesn't break a streak until today is over — yesterday
  // still counts as "current" so the number doesn't drop the instant you wake
  // up. Anything older than yesterday means a day was skipped entirely.
  const yesterday = addDays(today, -1);
  const latestKeepsStreakAlive = latest === today || latest === yesterday;

  if (!latestKeepsStreakAlive) return { current: 0, longest };

  let current = 1;
  for (let i = distinct.length - 1; i > 0; i -= 1) {
    const day = distinct[i] as IsoDate;
    const prev = distinct[i - 1] as IsoDate;
    if (prev === addDays(day, -1)) {
      current += 1;
    } else {
      break;
    }
  }

  return { current, longest };
}
