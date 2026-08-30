import { Hono } from 'hono';
import { isoDateOf } from '@spendlygo/core';
import { categoriesRepo } from '@spendlygo/db';
import type { CategoriesResponse, MeResponse } from '@spendlygo/shared';
import type { AppContext } from '../context.js';
import { requireInitData, type ApiEnv } from '../middleware/auth.js';

export function createApiRouter(ctx: AppContext): Hono<ApiEnv> {
  const api = new Hono<ApiEnv>();

  api.use('*', requireInitData(ctx));

  api.get('/me', (c) => {
    const user = c.get('user');

    // PRD F7.2: "today" is resolved server-side in the user's timezone. The
    // client must never derive a period boundary from the device clock.
    const body: MeResponse = {
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        firstName: user.firstName,
        username: user.username,
        timezone: user.timezone,
        currency: user.currency,
        locale: user.locale,
        monthlyBudgetCents: user.monthlyBudgetCents,
        digestHour: user.digestHour,
        digestEnabled: user.digestEnabled,
        nudgeEnabled: user.nudgeEnabled,
        onboardedAt: user.onboardedAt?.toISOString() ?? null,
      },
      today: isoDateOf(ctx.clock.now(), user.timezone),
    };

    return c.json(body);
  });

  api.get('/categories', async (c) => {
    const user = c.get('user');
    const rows = await categoriesRepo.listForUser(ctx.db, user.id);

    const body: CategoriesResponse = {
      categories: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        emoji: row.emoji,
        colorToken: row.colorToken,
        kind: row.kind,
        excludeFromBudget: row.excludeFromBudget,
        sortOrder: row.sortOrder,
      })),
    };

    return c.json(body);
  });

  return api;
}
