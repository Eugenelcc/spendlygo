/**
 * Recurring materialisation, run from the hourly tick (PRD F5).
 *
 * GUARDRAILS.md section 3: idempotent by construction. `materialiseOccurrence`
 * inserts into `recurring_runs` on a unique (rule_id, occurrence_date) key, so
 * a double-fired tick, or two tick invocations racing each other, can each try
 * every occurrence and only one will ever win.
 */

import {
  addDays,
  compareIsoDate,
  isoDateOf,
  occurrencesInRange,
  type IsoDate,
} from '@spendlygo/core';
import { recurringRepo, usersRepo, type RecurringRule } from '@spendlygo/db';
import type { AppContext } from '../context.js';
import { describeError, logger } from '../logger.js';

/** How far back to backfill when a rule has never run — not "since 1970". */
const MAX_BACKFILL_DAYS = 90;

function toEngineRule(rule: RecurringRule) {
  return {
    cadence: rule.cadence,
    anchorDate: rule.anchorDate as IsoDate,
    dayOfMonth: rule.dayOfMonth,
    endDate: rule.endDate as IsoDate | null,
  };
}

/**
 * Materialise every due occurrence for every active rule.
 *
 * PRD F5.4: if the service was asleep, every missed occurrence since the
 * rule's watermark is produced — capped so a rule that sat inactive for a
 * year doesn't suddenly post ninety back-dated transactions.
 */
export async function materialiseRecurring(ctx: AppContext): Promise<number> {
  const rules = await recurringRepo.listAllActive(ctx.db);
  if (rules.length === 0) return 0;

  // One user lookup per distinct user, not per rule — most users have more
  // than one rule (rent AND salary), and this runs every hour.
  const userIds = [...new Set(rules.map((rule) => rule.userId))];
  const users = await Promise.all(userIds.map((id) => usersRepo.findById(ctx.db, id)));
  const userById = new Map(users.filter((u) => u !== null).map((u) => [u.id, u]));

  let materialised = 0;

  for (const rule of rules) {
    const user = userById.get(rule.userId);
    if (!user) continue; // Orphaned rule; nothing sensible to do with it here.

    const today = isoDateOf(ctx.clock.now(), user.timezone);
    const earliestBackfill = addDays(today, -MAX_BACKFILL_DAYS);
    const from =
      rule.lastRunOn === null
        ? maxIso(rule.anchorDate as IsoDate, earliestBackfill)
        : addDays(rule.lastRunOn as IsoDate, 1);

    if (compareIsoDate(from, today) > 0) continue; // Nothing due yet.

    const due = occurrencesInRange(toEngineRule(rule), from, today);
    if (due.length === 0) continue;

    for (const occurrence of due) {
      try {
        const created = await recurringRepo.materialiseOccurrence(ctx.db, rule, occurrence);
        if (created) materialised += 1;
      } catch (error) {
        // One bad occurrence must not stop the rest of this rule, or every
        // other user's rules, from materialising.
        logger.error('tick.recurring_failed', {
          ruleId: rule.id,
          occurrence,
          ...describeError(error),
        });
        break;
      }
    }

    await recurringRepo.updateLastRunOn(ctx.db, rule.id, due[due.length - 1] as IsoDate);
  }

  return materialised;
}

function maxIso(a: IsoDate, b: IsoDate): IsoDate {
  return compareIsoDate(a, b) >= 0 ? a : b;
}
