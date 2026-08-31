/**
 * Integration tests for the savings-goals API surface.
 *
 * GUARDRAILS.md section 13: money maths and cross-user isolation each get
 * their own tests. Here that means proving a goal is invisible to anyone but
 * its owner even inside a shared household, and that funding a goal never
 * moves the shared safe-to-spend figure.
 */

import { createHmac } from 'node:crypto';
import { Bot } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fixedClock } from '@spendlygo/core';
import { createDatabase, schema, type DatabaseHandle } from '@spendlygo/db';
import { savingsGoalResponseSchema, savingsGoalsResponseSchema } from '@spendlygo/shared';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const BOT_TOKEN = '111111:AAH-test-token-for-integration-tests';
const NOW = new Date('2026-08-27T04:00:00Z');

const OWNER = 990100000001n;
const PARTNER = 990100000002n;
const STRANGER = 990100000003n;

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

describeIfDb('savings goals API', () => {
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
    ocrSpaceApiKey: undefined,
    allowedTelegramIds: new Set<bigint>(),
    defaultTimezone: 'Asia/Singapore',
    autoSetWebhook: false,
    version: 'test',
  };

  const cleanUsers = async () => {
    for (const id of [OWNER, PARTNER, STRANGER]) {
      const rows = await handle.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.telegramId, id));
      for (const row of rows) {
        await handle.db.delete(schema.households).where(eq(schema.households.createdBy, row.id));
      }
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, id));
    }
  };

  beforeAll(async () => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    const ctx: AppContext = { config, db: handle.db, dbHandle: handle, clock: fixedClock(NOW) };
    app = createApp(ctx, new Bot(BOT_TOKEN, { botInfo: undefined as never }), {
      state: { bot: 'ready', webhook: 'registered' },
    });
  });

  beforeEach(cleanUsers);
  afterAll(async () => {
    await cleanUsers();
    await handle.close();
  });

  describe('POST /api/goals + GET /api/goals', () => {
    it('creates a goal with zero progress', async () => {
      const created = savingsGoalResponseSchema.parse(
        await json(
          await app.request('/api/goals', {
            method: 'POST',
            headers: auth(OWNER),
            body: JSON.stringify({
              name: 'Vacation',
              targetCents: 100_000,
              targetDate: '2026-12-31',
            }),
          }),
        ),
      );
      expect(created.goal.name).toBe('Vacation');
      expect(created.goal.contributedCents).toBe(0);
      expect(created.goal.achieved).toBe(false);

      const list = savingsGoalsResponseSchema.parse(
        await json(await app.request('/api/goals', { headers: auth(OWNER) })),
      );
      expect(list.goals).toHaveLength(1);
      expect(list.goals[0]?.id).toBe(created.goal.id);
    });

    it('rejects an unauthenticated request', async () => {
      const response = await app.request('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X', targetCents: 100 }),
      });
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/goals/:id/contribute', () => {
    it('tags a transfer transaction and updates progress, without moving safe-to-spend', async () => {
      await app.request('/api/settings', {
        method: 'PATCH',
        headers: auth(OWNER),
        body: JSON.stringify({ monthlyBudgetCents: 100_000 }),
      });

      const created = await json(
        await app.request('/api/goals', {
          method: 'POST',
          headers: auth(OWNER),
          body: JSON.stringify({ name: 'Vacation', targetCents: 100_000 }),
        }),
      );

      const beforeToday = await json(await app.request('/api/today', { headers: auth(OWNER) }));

      const contributed = savingsGoalResponseSchema.parse(
        await json(
          await app.request(`/api/goals/${created.goal.id}/contribute`, {
            method: 'POST',
            headers: auth(OWNER),
            body: JSON.stringify({ amountCents: 40_000 }),
          }),
        ),
      );
      expect(contributed.goal.contributedCents).toBe(40_000);
      expect(contributed.goal.remainingCents).toBe(60_000);

      const afterToday = await json(await app.request('/api/today', { headers: auth(OWNER) }));
      // PRD F6.7: transfers are excluded from the budget by default.
      expect(afterToday.safeToSpend.leftForTodayCents).toBe(
        beforeToday.safeToSpend.leftForTodayCents,
      );
    });

    it('nets a withdrawal (direction: in) back out of the contributed total', async () => {
      const created = await json(
        await app.request('/api/goals', {
          method: 'POST',
          headers: auth(OWNER),
          body: JSON.stringify({ name: 'Vacation', targetCents: 100_000 }),
        }),
      );

      await app.request(`/api/goals/${created.goal.id}/contribute`, {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({ amountCents: 40_000 }),
      });

      const withdrawn = savingsGoalResponseSchema.parse(
        await json(
          await app.request(`/api/goals/${created.goal.id}/contribute`, {
            method: 'POST',
            headers: auth(OWNER),
            body: JSON.stringify({ amountCents: 15_000, direction: 'in' }),
          }),
        ),
      );
      expect(withdrawn.goal.contributedCents).toBe(25_000);
    });

    it('404s contributing to a goal that does not exist', async () => {
      const response = await app.request(
        '/api/goals/00000000-0000-0000-0000-000000000000/contribute',
        {
          method: 'POST',
          headers: auth(OWNER),
          body: JSON.stringify({ amountCents: 1_000 }),
        },
      );
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH and DELETE /api/goals/:id', () => {
    it('updates the target and target date', async () => {
      const created = await json(
        await app.request('/api/goals', {
          method: 'POST',
          headers: auth(OWNER),
          body: JSON.stringify({ name: 'Vacation', targetCents: 100_000 }),
        }),
      );

      const updated = savingsGoalResponseSchema.parse(
        await json(
          await app.request(`/api/goals/${created.goal.id}`, {
            method: 'PATCH',
            headers: auth(OWNER),
            body: JSON.stringify({ targetCents: 200_000 }),
          }),
        ),
      );
      expect(updated.goal.targetCents).toBe(200_000);
    });

    it('archives a goal so it drops out of the list', async () => {
      const created = await json(
        await app.request('/api/goals', {
          method: 'POST',
          headers: auth(OWNER),
          body: JSON.stringify({ name: 'Vacation', targetCents: 100_000 }),
        }),
      );

      const deleteResponse = await app.request(`/api/goals/${created.goal.id}`, {
        method: 'DELETE',
        headers: auth(OWNER),
      });
      expect(deleteResponse.status).toBe(200);

      const list = savingsGoalsResponseSchema.parse(
        await json(await app.request('/api/goals', { headers: auth(OWNER) })),
      );
      expect(list.goals).toHaveLength(0);
    });
  });

  describe('cross-user isolation, even inside a shared household', () => {
    it("a household partner cannot see, update, or contribute to the other's goal", async () => {
      const invite = await json(
        await app.request('/api/household/invite', { method: 'POST', headers: auth(OWNER) }),
      );
      const { householdsRepo, usersRepo } = await import('@spendlygo/db');
      const partner = await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: PARTNER,
        timezone: 'Asia/Singapore',
      });
      await householdsRepo.joinByCode(handle.db, invite.code, partner.id);

      const created = await json(
        await app.request('/api/goals', {
          method: 'POST',
          headers: auth(OWNER),
          body: JSON.stringify({ name: 'Vacation', targetCents: 100_000 }),
        }),
      );

      const partnerList = savingsGoalsResponseSchema.parse(
        await json(await app.request('/api/goals', { headers: auth(PARTNER) })),
      );
      expect(partnerList.goals).toHaveLength(0);

      const patchResponse = await app.request(`/api/goals/${created.goal.id}`, {
        method: 'PATCH',
        headers: auth(PARTNER),
        body: JSON.stringify({ targetCents: 1 }),
      });
      expect(patchResponse.status).toBe(404);

      const contributeResponse = await app.request(`/api/goals/${created.goal.id}/contribute`, {
        method: 'POST',
        headers: auth(PARTNER),
        body: JSON.stringify({ amountCents: 1_000 }),
      });
      expect(contributeResponse.status).toBe(404);
    });

    it("a stranger's goal list never includes another user's goals", async () => {
      await app.request('/api/goals', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({ name: 'Vacation', targetCents: 100_000 }),
      });

      const strangerList = savingsGoalsResponseSchema.parse(
        await json(await app.request('/api/goals', { headers: auth(STRANGER) })),
      );
      expect(strangerList.goals).toHaveLength(0);
    });
  });
});
