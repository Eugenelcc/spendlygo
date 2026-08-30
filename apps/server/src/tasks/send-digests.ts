/**
 * Sends the daily digest to every user whose local hour matches their
 * configured digest hour (PRD F9.1).
 *
 * The tick runs once per UTC hour, so a user's digest fires within that same
 * hour window in their own timezone — checked here rather than trusting the
 * cron's timing to align with anyone's wall clock.
 */

import { hourOf, isoDateOf } from '@spendlygo/core';
import { usersRepo, type User } from '@spendlygo/db';
import type { Bot } from 'grammy';
import type { BotContext } from '../bot/middleware.js';
import { buildDigest } from './digest.js';
import type { AppContext } from '../context.js';
import { describeError, logger } from '../logger.js';

export async function sendDueDigests(ctx: AppContext, bot: Bot<BotContext>): Promise<number> {
  const users = await usersRepo.listDigestEligible(ctx.db);
  let sent = 0;

  for (const user of users) {
    if (!isDueThisHour(ctx, user)) continue;

    try {
      const today = isoDateOf(ctx.clock.now(), user.timezone);
      const digest = await buildDigest(ctx, user, today);
      if (!digest.worthSending) continue;

      await bot.api.sendMessage(user.telegramId.toString(), digest.text, {
        parse_mode: 'Markdown',
      });
      sent += 1;
    } catch (error) {
      // One user's failure (blocked the bot, network hiccup) must not stop
      // everyone else's digest from going out.
      logger.warn('tick.digest_failed', { userId: user.id, ...describeError(error) });
    }
  }

  return sent;
}

function isDueThisHour(ctx: AppContext, user: User): boolean {
  return hourOf(ctx.clock.now(), user.timezone) === user.digestHour;
}
