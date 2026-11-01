/**
 * Telling the other members of a shared space that someone changed its budget
 * cycle start day (F17, owner decision F5). Plain text, no amounts
 * (GUARDRAILS §6); logs carry the user id only.
 */

import type { Api } from 'grammy';
import {
  cycleContaining,
  formatCycleRange,
  monthName,
  ordinalDay,
  parseIsoDate,
  type BudgetCycle,
} from '@spendlygo/core';
import { householdsRepo, type User } from '@spendlygo/db';
import type { AppContext } from '../context.js';
import { describeError, logger } from '../logger.js';
import { sendMessageWithRetry } from '../telegram/send-with-retry.js';
import { todayFor } from './service.js';

export function buildCycleChangeText(actor: User, cycle: BudgetCycle): string {
  const name = actor.firstName ?? 'Someone in your shared space';
  if (cycle.startDay === 1) {
    return `${name} set this shared space's budget month back to the calendar month. This month: ${monthName(parseIsoDate(cycle.start).month)}.`;
  }
  return `${name} set this shared space's budget month to start on the ${ordinalDay(cycle.startDay)}. This cycle: ${formatCycleRange(cycle)}.`;
}

/**
 * One message per other member, sent one after another (well under Telegram's
 * per-chat and overall limits, GUARDRAILS §10). A failure is logged and skipped;
 * this never throws. Returns how many were sent.
 */
export async function notifyCycleChange(
  ctx: AppContext,
  api: Api,
  actor: User,
  householdId: string,
  day: number,
  sleep?: (ms: number) => Promise<void>,
): Promise<number> {
  let sent = 0;
  try {
    const members = (await householdsRepo.membersOf(ctx.db, householdId)).filter(
      (member) => member.id !== actor.id,
    );
    for (const member of members) {
      try {
        // The recipient's own timezone decides which cycle "now" is in.
        const cycle = cycleContaining(todayFor(ctx, member), day);
        await sendMessageWithRetry(
          api,
          member.telegramId.toString(),
          buildCycleChangeText(actor, cycle),
          sleep,
        );
        sent++;
      } catch (error) {
        logger.warn('settings.cycle_notify_failed', { userId: member.id, ...describeError(error) });
      }
    }
  } catch (error) {
    logger.warn('settings.cycle_notify_failed', { userId: actor.id, ...describeError(error) });
  }
  return sent;
}
