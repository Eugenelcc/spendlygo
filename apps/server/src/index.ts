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
import { configureBotMenu, createBot } from './bot/index.js';
import type { AppContext } from './context.js';
import { describeError, logger, setLogLevel } from './logger.js';

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
   */
  const initBot = async (delayMs = BOT_INIT_RETRY_MS): Promise<void> => {
    try {
      await bot.init();
      botReady = true;
      logger.info('bot.ready', { username: bot.botInfo.username });

      await configureBotMenu(bot, ctx);
      logger.info('bot.menu_configured');
    } catch (error) {
      logger.warn('bot.init_failed', { retryInMs: delayMs, ...describeError(error) });
      setTimeout(() => {
        void initBot(Math.min(delayMs * 2, BOT_INIT_MAX_RETRY_MS));
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
