/**
 * Boot.
 *
 * One process serves the bot webhook, the Mini App API, and the scheduled tick.
 * GUARDRAILS.md section 1: a second Render web service would breach the
 * 750 instance-hour free quota, so everything shares this one.
 *
 * Order matters. The HTTP server starts BEFORE the bot contacts Telegram, so
 * `/healthz` answers within milliseconds of the process starting. If boot
 * blocked on `bot.init()`, a slow or unreachable Telegram would fail Render's
 * health check and roll back an otherwise fine deploy — and on the free tier
 * every cold start would inherit that risk.
 */

import { serve } from '@hono/node-server';
import { systemClock } from '@spendlygo/core';
import { createDatabase } from '@spendlygo/db';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { configureBotMenu, createBot, ensureWebhook } from './bot/index.js';
import type { AppContext } from './context.js';
import { describeError, logger, setLogLevel } from './logger.js';
import { isPermanentTelegramError } from './telegram/errors.js';

const BOT_INIT_RETRY_MS = 5_000;
const BOT_INIT_MAX_RETRY_MS = 60_000;

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.isProduction ? 'info' : 'debug');

  const dbHandle = createDatabase(config.databaseUrl);

  const ctx: AppContext = {
    config,
    db: dbHandle.db,
    dbHandle,
    clock: systemClock,
  };

  const bot = createBot(ctx);
  let botReady = false;

  const app = createApp(ctx, bot, { isBotReady: () => botReady });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info('server.listening', {
      port: info.port,
      env: config.nodeEnv,
      allowlisted: config.allowedTelegramIds.size,
      miniapp: config.miniappUrl,
    });
  });

  /**
   * grammY needs its bot info before it can dispatch webhook updates. Retry
   * with backoff instead of exiting: a transient Telegram outage should leave
   * the service up and answering health checks, not take it down.
   *
   * Only `bot.init()` is retried here. Menu setup and webhook registration are
   * separate best-effort steps, because re-running the whole sequence for a
   * failure in the last stage means re-fetching bot info and rewriting the
   * command menu on every attempt — wasted calls against Telegram's rate limit.
   */
  const initBot = async (delayMs = BOT_INIT_RETRY_MS): Promise<void> => {
    try {
      await bot.init();
    } catch (error) {
      logger.warn('bot.init_failed', { retryInMs: delayMs, ...describeError(error) });
      setTimeout(() => {
        void initBot(Math.min(delayMs * 2, BOT_INIT_MAX_RETRY_MS));
      }, delayMs).unref();
      return;
    }

    botReady = true;
    logger.info('bot.ready', { username: bot.botInfo.username });

    configureBotMenu(bot, ctx)
      .then(() => logger.info('bot.menu_configured'))
      .catch((error) => logger.warn('bot.menu_setup_failed', describeError(error)));

    // Last, because it starts traffic flowing: the server must be ready to
    // handle updates before Telegram is told where to deliver them.
    void registerWebhook();
  };

  /**
   * Webhook registration, retried only when retrying could help.
   *
   * A 4xx from `setWebhook` means the request itself is wrong — a malformed URL,
   * an illegal secret token — and will fail identically forever. Retrying it
   * every minute just buries the real error in a scrolling log, so we surface it
   * once, loudly, and stop.
   */
  const registerWebhook = async (delayMs = BOT_INIT_RETRY_MS): Promise<void> => {
    try {
      await ensureWebhook(bot, ctx);
    } catch (error) {
      if (isPermanentTelegramError(error)) {
        logger.error('webhook.registration_rejected', {
          hint: 'Telegram refused this request and will keep refusing it. Fix the cause; retrying will not help.',
          ...describeError(error),
        });
        return;
      }

      logger.warn('webhook.registration_failed', {
        retryInMs: delayMs,
        ...describeError(error),
      });
      setTimeout(() => {
        void registerWebhook(Math.min(delayMs * 2, BOT_INIT_MAX_RETRY_MS));
      }, delayMs).unref();
    }
  };

  void initBot();

  const shutdown = (signal: string) => {
    logger.info('server.shutdown', { signal });
    server.close(() => {
      void dbHandle.close().finally(() => process.exit(0));
    });
    // Render allows ~30s for a graceful stop; don't outstay it.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('server.boot_failed', describeError(error));
  process.exit(1);
});
