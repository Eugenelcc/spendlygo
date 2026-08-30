/**
 * Mini App authentication.
 *
 * GUARDRAILS.md section 4: the authenticated identity comes ONLY from validated
 * `initData`. No route may accept a user id from a body, query string, or
 * header — which is why this middleware is the only thing that sets `user`.
 */

import type { MiddlewareHandler } from 'hono';
import { UnauthorizedError, ForbiddenError } from '@spendlygo/core';
import { usersRepo, type User } from '@spendlygo/db';
import type { AppContext } from '../context.js';
import { validateInitData, type ValidatedInitData } from '../telegram/init-data.js';
import { logger } from '../logger.js';

export interface ApiEnv {
  Variables: {
    user: User;
    initData: ValidatedInitData;
  };
}

function readInitData(header: string | undefined, fallback: string | undefined): string | null {
  if (header) {
    // Telegram's convention for Mini App requests.
    const match = /^tma\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1];
  }
  return fallback ?? null;
}

export function requireInitData(ctx: AppContext): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const raw = readInitData(c.req.header('Authorization'), c.req.header('X-Telegram-Init-Data'));

    if (!raw) throw new UnauthorizedError('Missing initData — open this app from Telegram');

    const initData = validateInitData(raw, ctx.config.botToken, { now: ctx.clock.now() });

    const { allowedTelegramIds } = ctx.config;
    if (allowedTelegramIds.size > 0 && !allowedTelegramIds.has(initData.user.id)) {
      logger.warn('api.access_denied', { telegramId: String(initData.user.id) });
      throw new ForbiddenError('This account is not on the allowlist');
    }

    const user = await usersRepo.upsertByTelegramId(ctx.db, {
      telegramId: initData.user.id,
      firstName: initData.user.firstName,
      username: initData.user.username,
      timezone: ctx.config.defaultTimezone,
    });

    c.set('initData', initData);
    c.set('user', user);

    await next();
  };
}
