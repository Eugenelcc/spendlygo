import type { Context, MiddlewareFn } from 'grammy';
import { usersRepo, type User } from '@spendlygo/db';
import { logger } from '../logger.js';
import type { AppContext } from '../context.js';

export interface BotFlavor {
  /** Set by `withUser`. Present in every handler registered after it. */
  appUser: User;
}

export type BotContext = Context & BotFlavor;

/**
 * GUARDRAILS.md section 4: while the bot is private, only allowlisted Telegram
 * ids may use it. An unknown user gets a polite decline, never a stack trace
 * and never a hint about who the bot belongs to.
 */
export function allowlist(ctx: AppContext): MiddlewareFn<BotContext> {
  return async (botCtx, next) => {
    const from = botCtx.from;
    if (!from) return;

    const { allowedTelegramIds } = ctx.config;
    if (allowedTelegramIds.size > 0 && !allowedTelegramIds.has(BigInt(from.id))) {
      logger.warn('bot.access_denied', { telegramId: from.id });
      await botCtx.reply(
        'This is a private bot and your account is not on its allowlist.\n\n' +
          'Spendlygo is open source — you can run your own: github.com/Eugenelcc/spendlygo',
      );
      return;
    }

    await next();
  };
}

/** Resolves (and on first contact, creates) the Spendlygo user for this chat. */
export function withUser(ctx: AppContext): MiddlewareFn<BotContext> {
  return async (botCtx, next) => {
    const from = botCtx.from;
    if (!from) return;

    botCtx.appUser = await usersRepo.upsertByTelegramId(ctx.db, {
      telegramId: BigInt(from.id),
      firstName: from.first_name ?? null,
      username: from.username ?? null,
      timezone: ctx.config.defaultTimezone,
    });

    await next();
  };
}

/** Logs how long each update took, with no message content. */
export const timing: MiddlewareFn<BotContext> = async (botCtx, next) => {
  const startedAt = Date.now();
  await next();
  logger.info('bot.update', {
    telegramId: botCtx.from?.id,
    updateType: Object.keys(botCtx.update).find((key) => key !== 'update_id'),
    durationMs: Date.now() - startedAt,
  });
};
