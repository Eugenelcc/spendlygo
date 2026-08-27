/**
 * The scheduled tick (PRD section 11).
 *
 * Render's free tier has no cron, so an external free scheduler calls this
 * hourly. It does three jobs:
 *   1. materialise due recurring transactions   (PRD F5 — lands in P5)
 *   2. send digests due this hour                (PRD F9 — lands in P5)
 *   3. touch the database, so the Supabase free project never pauses
 *
 * GUARDRAILS.md section 3: this endpoint is idempotent. Running it twice in the
 * same hour is a no-op, because the cron will eventually double-fire.
 */

import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { TickResponse } from '@spendlygo/shared';
import { UnauthorizedError } from '@spendlygo/core';
import type { AppContext } from '../context.js';
import { describeError, logger } from '../logger.js';

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createTasksRouter(ctx: AppContext): Hono {
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

    // Recurring materialisation (F5) and digests (F9) are wired up in phase P5.
    const body: TickResponse = {
      ok: true,
      ranAt: ctx.clock.now().toISOString(),
      recurringMaterialised: 0,
      digestsSent: 0,
    };

    logger.info('tick.done', { durationMs: Date.now() - startedAt });
    return c.json(body);
  });

  return tasks;
}
