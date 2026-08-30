import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { webhookCallback } from 'grammy';
import type { HealthResponse } from '@spendlygo/shared';
import type { AppContext } from './context.js';
import type { SpendlygoBot } from './bot/index.js';
import { createApiRouter } from './api/index.js';
import { createTasksRouter } from './tasks/tick.js';
import { onError, onNotFound } from './middleware/errors.js';
import { logger } from './logger.js';
import type { RuntimeState } from './runtime-state.js';

const bootedAt = Date.now();

export interface CreateAppOptions {
  /**
   * Boot progress. The HTTP server starts before `bot.init()` resolves so that
   * `/healthz` answers immediately — see src/index.ts — which means the webhook
   * can receive an update while the bot is still initialising.
   */
  state: RuntimeState;
}

export function createApp(ctx: AppContext, bot: SpendlygoBot, options: CreateAppOptions): Hono {
  const app = new Hono();

  app.onError(onError);
  app.notFound(onNotFound);
  app.use('*', secureHeaders());

  /**
   * GUARDRAILS.md section 7: `/healthz` has ZERO dependencies — no database, no
   * Telegram call. It is what the 10-minute keep-alive ping hits to stop Render
   * spinning the free instance down, so it must answer in milliseconds even
   * mid-cold-start. A health check that touches the database is a health check
   * that fails when the database is slow, and then Render restarts us.
   */
  app.get('/healthz', (c) => {
    const body: HealthResponse = {
      status: 'ok',
      version: ctx.config.version,
      uptimeSeconds: Math.floor((Date.now() - bootedAt) / 1000),
      bot: options.state.bot,
      webhook: options.state.webhook,
    };
    return c.json(body);
  });

  // The Mini App is served from a different origin (a Render static site), so
  // it needs CORS. Only that origin, and only the headers we actually use.
  app.use(
    '/api/*',
    cors({
      origin: ctx.config.miniappUrl,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'X-Telegram-Init-Data'],
      maxAge: 86_400,
    }),
  );

  /**
   * Telegram webhook.
   *
   * GUARDRAILS.md section 4: a request without the secret header is not from
   * Telegram. Verified here, before grammY sees the body, and answered with 401
   * rather than a hint about what was wrong.
   */
  const handleUpdate = webhookCallback(bot, 'hono');

  app.post('/telegram/webhook', async (c) => {
    const provided = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (provided !== ctx.config.webhookSecretToken) {
      logger.warn('webhook.rejected');
      return c.json({ error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
    }

    if (options.state.bot !== 'ready') {
      // 503 asks Telegram to redeliver rather than dropping the update. Losing
      // a transaction to a cold start would be a data-loss bug.
      logger.warn('webhook.not_ready');
      return c.json({ error: { code: 'starting_up', message: 'Bot is still starting' } }, 503, {
        'Retry-After': '5',
      });
    }

    return handleUpdate(c);
  });

  app.route('/api', createApiRouter(ctx));
  app.route('/tasks', createTasksRouter(ctx, bot));

  app.get('/', (c) =>
    c.json({
      name: 'spendlygo',
      version: ctx.config.version,
      docs: 'https://github.com/Eugenelcc/spendlygo',
    }),
  );

  return app;
}
