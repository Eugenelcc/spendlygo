/**
 * Sends the digest family to every eligible user (PRD F9).
 *
 * The daily digest fires when the user's LOCAL hour matches their configured
 * digestHour. The weekly and monthly digests fire at that same hour, gated on
 * the day: Sunday for weekly, the last day of the month for monthly. Per the
 * user's own choice, they are separate messages — a last-day-of-month Sunday
 * can produce three, which is a rare enough overlap to accept rather than
 * special-case.
 */

import { hourOf, isoDateOf } from '@spendlygo/core';
import { usersRepo, type User } from '@spendlygo/db';
import type { Bot } from 'grammy';
import type { BotContext } from '../bot/middleware.js';
import {
  buildDailyDigest,
  buildMonthlyDigest,
  buildWeeklyDigest,
  isMonthlyDigestDay,
  isWeeklyDigestDay,
} from './digest.js';
import type { AppContext } from '../context.js';
import { describeError, logger } from '../logger.js';

export async function sendDueDigests(ctx: AppContext, bot: Bot<BotContext>): Promise<number> {
  const users = await usersRepo.listDigestEligible(ctx.db);
  let sent = 0;

  for (const user of users) {
    if (!isDueThisHour(ctx, user)) continue;

    const today = isoDateOf(ctx.clock.now(), user.timezone);

    sent += await sendOne(bot, user, 'tick.daily_digest_failed', () =>
      buildDailyDigest(ctx, user, today),
    );

    if (isWeeklyDigestDay(today)) {
      sent += await sendOne(bot, user, 'tick.weekly_digest_failed', () =>
        buildWeeklyDigest(ctx, user, today),
      );
    }

    if (isMonthlyDigestDay(today)) {
      sent += await sendOne(bot, user, 'tick.monthly_digest_failed', () =>
        buildMonthlyDigest(ctx, user, today),
      );
    }
  }

  return sent;
}

async function sendOne(
  bot: Bot<BotContext>,
  user: User,
  errorEvent: string,
  build: () => Promise<{ text: string; worthSending: boolean }>,
): Promise<number> {
  try {
    const digest = await build();
    if (!digest.worthSending) return 0;

    await bot.api.sendMessage(user.telegramId.toString(), digest.text, { parse_mode: 'Markdown' });
    return 1;
  } catch (error) {
    // One user's failure (blocked the bot, network hiccup) must not stop
    // everyone else's digest from going out.
    logger.warn(errorEvent, { userId: user.id, ...describeError(error) });
    return 0;
  }
}

function isDueThisHour(ctx: AppContext, user: User): boolean {
  return hourOf(ctx.clock.now(), user.timezone) === user.digestHour;
}
