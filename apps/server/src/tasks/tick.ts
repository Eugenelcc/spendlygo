/**
 * The scheduled tick (PRD section 11).
 *
 * Render's free tier has no cron, so an external free scheduler calls this
 * hourly. It does three jobs:
 *   1. materialise due recurring transactions   (PRD F5)
 *   2. send digests due this hour                (PRD F9)
 *   3. touch the database, so the Supabase free project never pauses
 *
 * GUARDRAILS.md section 3: this endpoint is idempotent. Running it twice in the
 * same hour is a no-op — recurring materialisation is keyed on
 * (rule_id, occurrence_date), and a digest already sent this hour is simply
 * sent again only if the user's clock genuinely re-enters that hour, which a
 * retry within the same hour will not do differently.
 */

import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { TickResponse } from '@spendlygo/shared';
import { UnauthorizedError } from '@spendlygo/core';
import type { AppContext } from '../context.js';
import type { SpendlygoBot } from '../bot/index.js';
import { describeError, logger } from '../logger.js';
import { checkBudgetAlerts } from './alerts.js';
import { materialiseRecurring } from './recurring.js';
import { sendDueDigests } from './send-digests.js';

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createTasksRouter(ctx: AppContext, bot: SpendlygoBot): Hono {
  const tasks = new Hono();

  tasks.post('/tick', async (c) => {
    const header = c.req.header('Authorization') ?? '';
    const provided = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? '';

    if (!provided || !secretMatches(provided, ctx.config.cronSecret)) {
      logger.warn('tick.unauthorized');
      throw new UnauthorizedError('Invalid cron secret');
    }

    const startedAt = Date.now();

    // Keeps the Supabase free project from pausing after 7 idle days.
    try {
      await ctx.dbHandle.ping();
    } catch (error) {
      logger.error('tick.db_unreachable', describeError(error));
      throw error;
    }

    let recurringMaterialised = 0;
    try {
      recurringMaterialised = await materialiseRecurring(ctx);
    } catch (error) {
      // A recurring failure must not block digests from going out this hour.
      logger.error('tick.recurring_batch_failed', describeError(error));
    }

    let digestsSent = 0;
    try {
      digestsSent = await sendDueDigests(ctx, bot);
    } catch (error) {
      logger.error('tick.digest_batch_failed', describeError(error));
    }

    let alertsSent = 0;
    try {
      alertsSent = await checkBudgetAlerts(ctx, bot);
    } catch (error) {
      logger.error('tick.alert_batch_failed', describeError(error));
    }

    const body: TickResponse = {
      ok: true,
      ranAt: ctx.clock.now().toISOString(),
      recurringMaterialised,
      digestsSent,
      alertsSent,
    };

    logger.info('tick.done', {
      durationMs: Date.now() - startedAt,
      recurringMaterialised,
      digestsSent,
      alertsSent,
    });
    return c.json(body);
  });

  return tasks;
}
