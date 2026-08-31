/**
 * Proactive budget-threshold alerts, checked on every tick (not just at the
 * digest hour) so a threshold crossed at any moment gets flagged promptly.
 *
 * Regardless of category, per the user's own scoping — this watches total
 * month-to-date spend against the whole budget, not any one category.
 *
 * GUARDRAILS.md section 3: `alertsRepo.recordIfNew` is the idempotency guard.
 * Every tick re-evaluates every threshold for every user; a threshold already
 * announced this month is a no-op, so a double-fired tick cannot double-alert.
 */

import { formatCents, parseIsoDate, type AmountCents, type IsoDate } from '@spendlygo/core';
import { alertsRepo, usersRepo, type User } from '@spendlygo/db';
import type { Bot } from 'grammy';
import { computeSafeToSpend, todayFor } from '../api/service.js';
import { escapeMarkdown } from '../bot/markdown.js';
import type { BotContext } from '../bot/middleware.js';
import type { AppContext } from '../context.js';
import { describeError, logger } from '../logger.js';

/** Warn at 80%, and again once the budget is actually gone. */
const THRESHOLDS = [80, 100] as const;

export async function checkBudgetAlerts(ctx: AppContext, bot: Bot<BotContext>): Promise<number> {
  const users = await usersRepo.listAlertEligible(ctx.db);
  let sent = 0;

  for (const user of users) {
    try {
      sent += await checkOne(ctx, bot, user);
    } catch (error) {
      // One user's failure must not stop everyone else's alerts being checked.
      logger.warn('tick.alert_check_failed', { userId: user.id, ...describeError(error) });
    }
  }

  return sent;
}

async function checkOne(ctx: AppContext, bot: Bot<BotContext>, user: User): Promise<number> {
  const today = todayFor(ctx, user);
  const result = await computeSafeToSpend(ctx, user, today);
  if (!result.hasBudget) return 0;

  const usedPct = result.budgetUsedRatio * 100;
  const { year, month } = parseIsoDate(today);
  const already = await alertsRepo.sentThisMonth(ctx.db, user.id, year, month);

  let sent = 0;
  for (const threshold of THRESHOLDS) {
    if (usedPct < threshold) continue;
    if (already.has(threshold)) continue;

    // Reserving first, before sending, is what makes two ticks racing each
    // other safe: only one of them gets a non-null id back.
    const reservationId = await alertsRepo.recordIfNew(ctx.db, user.id, year, month, threshold);
    if (reservationId === null) continue;

    try {
      await bot.api.sendMessage(
        user.telegramId.toString(),
        buildAlertText(user, result, threshold, today),
        { parse_mode: 'Markdown' },
      );
      sent += 1;
    } catch (error) {
      // Delivery failed — release the reservation so a later tick retries
      // this threshold instead of believing it already went out.
      await alertsRepo.release(ctx.db, reservationId);
      logger.warn('tick.alert_send_failed', {
        userId: user.id,
        threshold,
        ...describeError(error),
      });
    }
  }

  return sent;
}

function buildAlertText(
  user: User,
  result: Awaited<ReturnType<typeof computeSafeToSpend>>,
  threshold: number,
  today: IsoDate,
): string {
  const money = (cents: number) =>
    escapeMarkdown(
      formatCents(cents as AmountCents, { currency: user.currency, locale: user.locale }),
    );

  if (threshold >= 100) {
    return [
      `🔴 *Budget spent* — you're ${money(result.overspentCents)} over for ${escapeMarkdown(today.slice(0, 7))}`,
      '',
      `${money(result.spentMonthToDateCents)} of ${money(result.budgetCents ?? (0 as AmountCents))} spent, ${result.daysRemaining} days left.`,
    ].join('\n');
  }

  return [
    `🟠 *${threshold}% of your budget spent* — ${money(result.remainingCents)} left with ${result.daysRemaining} days to go`,
    '',
    `That's ${money(result.safeTodayCents)} a day if you spread the rest evenly.`,
  ].join('\n');
}
