/**
 * Integration tests for the household API surface.
 *
 * GUARDRAILS.md section 13: unauthenticated AND cross-user access get their
 * own tests. Here that means proving a stranger cannot see, spend against, or
 * otherwise touch a household they were never invited into.
 */

import { createHmac } from 'node:crypto';
import { Bot } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fixedClock } from '@spendlygo/core';
import { createDatabase, schema, type DatabaseHandle } from '@spendlygo/db';
import { householdResponseSchema, meResponseSchema } from '@spendlygo/shared';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const BOT_TOKEN = '111111:AAH-test-token-for-integration-tests';
const NOW = new Date('2026-08-27T04:00:00Z');

const CREATOR = 990000000001n;
const PARTNER = 990000000002n;
const STRANGER = 990000000003n;

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

describeIfDb('household API', () => {
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
    for (const id of [CREATOR, PARTNER, STRANGER]) {
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

  describe('GET /api/me', () => {
    it('reports household: null when solo', async () => {
      const body = meResponseSchema.parse(
        await json(await app.request('/api/me', { headers: auth(CREATOR) })),
      );
      expect(body.household).toBeNull();
    });

    it('reports members once in a household', async () => {
      await app.request('/api/household/invite', { method: 'POST', headers: auth(CREATOR) });
      const body = meResponseSchema.parse(
        await json(await app.request('/api/me', { headers: auth(CREATOR) })),
      );
      expect(body.household?.members).toHaveLength(1);
      expect(body.household?.members[0]?.isSelf).toBe(true);
    });
  });

  describe('POST /api/household/invite + join', () => {
    it('lets a second account join with the code', async () => {
      const invite = await json(
        await app.request('/api/household/invite', { method: 'POST', headers: auth(CREATOR) }),
      );
      expect(invite.code).toMatch(/^[A-Z0-9]{6}$/);

      // No public join endpoint (PRD: joining happens via /join in chat) — the
      // repository call is exercised directly here to seed a real household
      // for the isolation tests below.
      const { householdsRepo, usersRepo } = await import('@spendlygo/db');
      const partner = await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: PARTNER,
        timezone: 'Asia/Singapore',
      });
      await householdsRepo.joinByCode(handle.db, invite.code, partner.id);

      const body = householdResponseSchema.parse(
        await json(await app.request('/api/household', { headers: auth(PARTNER) })),
      );
      expect(body.household?.members).toHaveLength(2);
    });

    it('rejects an unauthenticated invite request', async () => {
      const response = await app.request('/api/household/invite', { method: 'POST' });
      expect(response.status).toBe(401);
    });
  });

  describe('cross-household isolation', () => {
    it("a stranger's safe-to-spend never reflects someone else's shared budget", async () => {
      await app.request('/api/settings', {
        method: 'PATCH',
        headers: auth(CREATOR),
        body: JSON.stringify({ monthlyBudgetCents: 999_00 }),
      });
      await app.request('/api/household/invite', { method: 'POST', headers: auth(CREATOR) });
      await app.request('/api/transactions', {
        method: 'POST',
        headers: auth(CREATOR),
        body: JSON.stringify({ direction: 'out', amountCents: 5000 }),
      });

      const strangerToday = await json(
        await app.request('/api/today', { headers: auth(STRANGER) }),
      );
      expect(strangerToday.safeToSpend.hasBudget).toBe(false);
      expect(strangerToday.safeToSpend.spentTodayCents).toBe(0);
    });

    it("a stranger's /api/household never shows another household's members", async () => {
      await app.request('/api/household/invite', { method: 'POST', headers: auth(CREATOR) });
      const body = householdResponseSchema.parse(
        await json(await app.request('/api/household', { headers: auth(STRANGER) })),
      );
      expect(body.household).toBeNull();
    });
  });

  describe('POST /api/household/leave', () => {
    it('is a harmless no-op for someone not in a household', async () => {
      const response = await app.request('/api/household/leave', {
        method: 'POST',
        headers: auth(CREATOR),
      });
      expect(response.status).toBe(200);
    });

    it('removes the caller from the household without affecting other members', async () => {
      const invite = await json(
        await app.request('/api/household/invite', { method: 'POST', headers: auth(CREATOR) }),
      );
      const { householdsRepo, usersRepo } = await import('@spendlygo/db');
      const partner = await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: PARTNER,
        timezone: 'Asia/Singapore',
      });
      await householdsRepo.joinByCode(handle.db, invite.code, partner.id);

      await app.request('/api/household/leave', { method: 'POST', headers: auth(CREATOR) });

      const creatorMe = meResponseSchema.parse(
        await json(await app.request('/api/me', { headers: auth(CREATOR) })),
      );
      expect(creatorMe.household).toBeNull();

      const partnerHousehold = householdResponseSchema.parse(
        await json(await app.request('/api/household', { headers: auth(PARTNER) })),
      );
      expect(partnerHousehold.household?.members).toHaveLength(1);
    });
  });

  describe('PATCH /api/settings — shared budget', () => {
    it('either member can change it, and both then see the same figure', async () => {
      const invite = await json(
        await app.request('/api/household/invite', { method: 'POST', headers: auth(CREATOR) }),
      );
      const { householdsRepo, usersRepo } = await import('@spendlygo/db');
      const partner = await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: PARTNER,
        timezone: 'Asia/Singapore',
      });
      await householdsRepo.joinByCode(handle.db, invite.code, partner.id);

      // The PARTNER sets it, not the creator.
      await app.request('/api/settings', {
        method: 'PATCH',
        headers: auth(PARTNER),
        body: JSON.stringify({ monthlyBudgetCents: 150_000 }),
      });

      const creatorMe = await json(await app.request('/api/me', { headers: auth(CREATOR) }));
      const partnerMe = await json(await app.request('/api/me', { headers: auth(PARTNER) }));
      expect(creatorMe.user.monthlyBudgetCents).toBe(150_000);
      expect(partnerMe.user.monthlyBudgetCents).toBe(150_000);
    });
  });
});
