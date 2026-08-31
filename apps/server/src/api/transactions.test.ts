/**
 * Integration tests for the transaction and stats routes.
 *
 * GUARDRAILS.md section 13: every route is tested for unauthenticated AND
 * cross-user access. The cross-user cases matter most — a leak there is the
 * difference between a private tracker and a public one.
 */

import { createHmac } from 'node:crypto';
import { Bot } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fixedClock } from '@spendlygo/core';
import { createDatabase, schema, type DatabaseHandle } from '@spendlygo/db';
import { recapResponseSchema, statsResponseSchema, todayResponseSchema } from '@spendlygo/shared';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const BOT_TOKEN = '111111:AAH-test-token-for-integration-tests';
const NOW = new Date('2026-08-27T04:00:00Z'); // noon in Singapore
const TODAY = '2026-08-27';

const OWNER = 910000000001n;
const OTHER = 910000000002n;

/** `Response.json()` is typed `unknown`; these tests assert on shapes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(response: Response): Promise<any> {
  return response.json();
}

function auth(telegramId: bigint): Record<string, string> {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 30),
    user: JSON.stringify({ id: Number(telegramId), first_name: 'Test' }),
  };
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return { Authorization: `tma ${params.toString()}`, 'Content-Type': 'application/json' };
}

describeIfDb('transactions API', () => {
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  const config: Config = {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    botToken: BOT_TOKEN,
    webhookSecretToken: 'secret-token-for-tests',
    databaseUrl: TEST_DATABASE_URL ?? '',
    miniappUrl: 'https://app.example.test',
    serverUrl: undefined,
    cronSecret: 'cron-secret-for-tests-000',
    allowedTelegramIds: new Set<bigint>(),
    defaultTimezone: 'Asia/Singapore',
    autoSetWebhook: false,
    version: 'test',
  };

  const cleanUsers = async () => {
    for (const id of [OWNER, OTHER]) {
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, id));
    }
  };

  beforeAll(async () => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });

    const ctx: AppContext = {
      config,
      db: handle.db,
      dbHandle: handle,
      clock: fixedClock(NOW),
    };
    app = createApp(ctx, new Bot(BOT_TOKEN, { botInfo: undefined as never }), {
      state: { bot: 'ready', webhook: 'registered' },
    });
  });

  beforeEach(cleanUsers);

  afterAll(async () => {
    await cleanUsers();
    await handle.close();
  });

  const post = (telegramId: bigint, body: unknown) =>
    app.request('/api/transactions', {
      method: 'POST',
      headers: auth(telegramId),
      body: JSON.stringify(body),
    });

  describe('POST /api/transactions', () => {
    it('creates a transaction and returns the recalculated figure', async () => {
      const response = await post(OWNER, { direction: 'out', amountCents: 1250, note: 'lunch' });
      expect(response.status).toBe(201);

      const body = await json(response);
      expect(body.transaction.amountCents).toBe(1250);
      expect(body.transaction.occurredOn).toBe(TODAY);
      expect(body.transaction.source).toBe('miniapp');
      // Inferred from the note, with no category supplied (PRD F10.4).
      expect(body.transaction.categorySlug).toBe('food');
      expect(body.safeToSpend.spentTodayCents).toBe(1250);
    });

    it('rejects a zero or negative amount', async () => {
      expect((await post(OWNER, { direction: 'out', amountCents: 0 })).status).toBe(400);
      expect((await post(OWNER, { direction: 'out', amountCents: -500 })).status).toBe(400);
    });

    it('rejects a fractional amount — cents are integers', async () => {
      expect((await post(OWNER, { direction: 'out', amountCents: 12.5 })).status).toBe(400);
    });

    it('rejects an unauthenticated request', async () => {
      const response = await app.request('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'out', amountCents: 100 }),
      });
      expect(response.status).toBe(401);
    });
  });

  describe('cross-user isolation', () => {
    it("never returns another user's transactions", async () => {
      await post(OWNER, { direction: 'out', amountCents: 5000, note: 'owner secret' });

      const response = await app.request('/api/transactions', { headers: auth(OTHER) });
      const body = await json(response);
      expect(body.transactions).toHaveLength(0);
    });

    it("cannot delete another user's transaction", async () => {
      const created = await json(await post(OWNER, { direction: 'out', amountCents: 5000 }));

      const attack = await app.request(`/api/transactions/${created.transaction.id}`, {
        method: 'DELETE',
        headers: auth(OTHER),
      });
      expect(attack.status).toBe(404);

      // And it is genuinely still there.
      const mine = await json(await app.request('/api/transactions', { headers: auth(OWNER) }));
      expect(mine.transactions).toHaveLength(1);
    });

    it("cannot edit another user's transaction", async () => {
      const created = await json(await post(OWNER, { direction: 'out', amountCents: 5000 }));

      const attack = await app.request(`/api/transactions/${created.transaction.id}`, {
        method: 'PATCH',
        headers: auth(OTHER),
        body: JSON.stringify({ amountCents: 1 }),
      });
      expect(attack.status).toBe(404);
    });

    it("keeps one user's totals out of another's", async () => {
      await post(OWNER, { direction: 'out', amountCents: 9900 });

      const theirs = await json(await app.request('/api/today', { headers: auth(OTHER) }));
      expect(theirs.safeToSpend.spentTodayCents).toBe(0);
    });
  });

  describe('DELETE /api/transactions/:id', () => {
    it('soft-deletes and removes it from the totals', async () => {
      const created = await json(await post(OWNER, { direction: 'out', amountCents: 4200 }));

      const response = await app.request(`/api/transactions/${created.transaction.id}`, {
        method: 'DELETE',
        headers: auth(OWNER),
      });
      expect(response.status).toBe(200);
      expect((await json(response)).safeToSpend.spentTodayCents).toBe(0);

      const list = await json(await app.request('/api/transactions', { headers: auth(OWNER) }));
      expect(list.transactions).toHaveLength(0);
    });

    it('404s on an id that is already gone', async () => {
      const response = await app.request('/api/transactions/00000000-0000-4000-8000-000000000000', {
        method: 'DELETE',
        headers: auth(OWNER),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/today', () => {
    it('matches the published contract', async () => {
      const response = await app.request('/api/today', { headers: auth(OWNER) });
      const body = todayResponseSchema.parse(await json(response));

      expect(body.today).toBe(TODAY);
      expect(body.currency).toBe('SGD');
      // 7 days of sparkline, gaps filled, oldest first.
      expect(body.recentDays).toHaveLength(7);
      expect(body.recentDays.at(-1)?.day).toBe(TODAY);
      // No history seeded for this fresh user — zero, not undefined or an error.
      expect(body.streak).toEqual({ current: 0, longest: 0 });
    });

    it('reports no budget honestly rather than inventing one (PRD F6.6)', async () => {
      const body = await json(await app.request('/api/today', { headers: auth(OWNER) }));
      expect(body.safeToSpend.hasBudget).toBe(false);
      expect(body.safeToSpend.safeTodayCents).toBe(0);
    });

    it('computes what is safe once a budget is set', async () => {
      await app.request('/api/settings', {
        method: 'PATCH',
        headers: auth(OWNER),
        body: JSON.stringify({ monthlyBudgetCents: 310_00 }),
      });
      await post(OWNER, { direction: 'out', amountCents: 1000 });

      const body = await json(await app.request('/api/today', { headers: auth(OWNER) }));
      // 27 August: 5 days left including today. (31000 - 1000) / 5 = 6000.
      expect(body.safeToSpend.hasBudget).toBe(true);
      expect(body.safeToSpend.daysRemaining).toBe(5);
      expect(body.safeToSpend.safeTodayCents).toBe(6000);
      expect(body.safeToSpend.leftForTodayCents).toBe(5000);
    });

    it('excludes flagged categories from the budget (PRD F6.7)', async () => {
      await app.request('/api/settings', {
        method: 'PATCH',
        headers: auth(OWNER),
        body: JSON.stringify({ monthlyBudgetCents: 100_000 }),
      });

      const categories = await json(await app.request('/api/categories', { headers: auth(OWNER) }));
      const transfers = categories.categories.find((c: { slug: string }) => c.slug === 'transfers');

      await post(OWNER, { direction: 'out', amountCents: 50_000, categoryId: transfers.id });

      const body = await json(await app.request('/api/today', { headers: auth(OWNER) }));
      // The transfer shows in the month total but must not move safe-to-spend.
      expect(body.monthOut).toBe(50_000);
      expect(body.safeToSpend.spentMonthToDateCents).toBe(0);
    });
  });

  describe('GET /api/stats', () => {
    it.each(['day', 'month', 'year'] as const)('matches the contract for %s', async (period) => {
      const response = await app.request(`/api/stats?period=${period}`, {
        headers: auth(OWNER),
      });
      expect(response.status).toBe(200);
      const body = statsResponseSchema.parse(await json(response));
      expect(body.period).toBe(period);
    });

    it('fills every bucket, so a chart never has holes in it', async () => {
      const month = statsResponseSchema.parse(
        await json(await app.request('/api/stats?period=month', { headers: auth(OWNER) })),
      );
      expect(month.series).toHaveLength(31); // August

      const year = statsResponseSchema.parse(
        await json(await app.request('/api/stats?period=year', { headers: auth(OWNER) })),
      );
      expect(year.series).toHaveLength(12);
    });

    it('splits income from expense rather than netting them off', async () => {
      await post(OWNER, { direction: 'out', amountCents: 3000 });
      await post(OWNER, { direction: 'in', amountCents: 10_000 });

      const body = statsResponseSchema.parse(
        await json(await app.request('/api/stats?period=month', { headers: auth(OWNER) })),
      );
      expect(body.outCents).toBe(3000);
      expect(body.inCents).toBe(10_000);
      expect(body.netCents).toBe(7000);
    });

    it('rejects an unauthenticated request', async () => {
      expect((await app.request('/api/stats?period=month')).status).toBe(401);
    });
  });

  describe('GET /api/recap', () => {
    it.each(['month', 'year'] as const)('matches the contract for %s', async (period) => {
      const response = await app.request(`/api/recap?period=${period}`, {
        headers: auth(OWNER),
      });
      expect(response.status).toBe(200);
      const body = recapResponseSchema.parse(await json(response));
      expect(body.period).toBe(period);
    });

    it('defaults to the month containing today when no period is given', async () => {
      const body = recapResponseSchema.parse(
        await json(await app.request('/api/recap', { headers: auth(OWNER) })),
      );
      expect(body.period).toBe('month');
      expect(body.label).toContain('August');
    });

    it('rejects an unauthenticated request', async () => {
      expect((await app.request('/api/recap?period=month')).status).toBe(401);
    });
  });

  describe('PATCH /api/settings', () => {
    it('sets and clears the budget', async () => {
      const set = await app.request('/api/settings', {
        method: 'PATCH',
        headers: auth(OWNER),
        body: JSON.stringify({ monthlyBudgetCents: 150_000 }),
      });
      expect((await json(set)).user.monthlyBudgetCents).toBe(150_000);

      const cleared = await app.request('/api/settings', {
        method: 'PATCH',
        headers: auth(OWNER),
        body: JSON.stringify({ monthlyBudgetCents: null }),
      });
      expect((await json(cleared)).user.monthlyBudgetCents).toBeNull();
    });

    it('rejects a negative budget', async () => {
      const response = await app.request('/api/settings', {
        method: 'PATCH',
        headers: auth(OWNER),
        body: JSON.stringify({ monthlyBudgetCents: -100 }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects an unauthenticated request', async () => {
      const response = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyBudgetCents: 1 }),
      });
      expect(response.status).toBe(401);
    });
  });
});
