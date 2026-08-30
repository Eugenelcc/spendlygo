/**
 * Integration tests for the HTTP surface.
 *
 * GUARDRAILS.md section 13: every API route needs a test asserting it rejects
 * unauthenticated and cross-user access. These run against a real Postgres —
 * an in-memory fake would not exercise the constraints that make the schema
 * safe. Skipped when TEST_DATABASE_URL is unset so `pnpm test` still works
 * without a database.
 */

import { createHmac } from 'node:crypto';
import { Bot } from 'grammy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fixedClock } from '@spendlygo/core';
import {
  categoriesResponseSchema,
  healthResponseSchema,
  meResponseSchema,
} from '@spendlygo/shared';
import { createDatabase, schema, type DatabaseHandle } from '@spendlygo/db';
import { createApp } from './app.js';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { setLogLevel } from './logger.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const BOT_TOKEN = '111111:AAH-test-token-for-integration-tests';
const WEBHOOK_SECRET = 'webhook-secret-for-tests-0123456789';
const CRON_SECRET = 'cron-secret-for-tests-0123456789';
const MINIAPP_URL = 'https://app.example.test';

const NOW = new Date('2026-08-27T04:00:00Z'); // 12:00 in Singapore
const OWNER_TELEGRAM_ID = 900000000001n;
const STRANGER_TELEGRAM_ID = 900000000002n;

function signedInitData(telegramId: bigint, token = BOT_TOKEN): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 30),
    user: JSON.stringify({ id: Number(telegramId), first_name: 'Test', username: 'test' }),
  };
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    botToken: BOT_TOKEN,
    webhookSecretToken: WEBHOOK_SECRET,
    databaseUrl: TEST_DATABASE_URL ?? '',
    miniappUrl: MINIAPP_URL,
    serverUrl: undefined,
    cronSecret: CRON_SECRET,
    allowedTelegramIds: new Set<bigint>(),
    defaultTimezone: 'Asia/Singapore',
    // Tests must never reach out and re-point a real bot's webhook.
    autoSetWebhook: false,
    version: 'test',
    ...overrides,
  };
}

describeIfDb('HTTP surface', () => {
  let handle: DatabaseHandle;

  const buildApp = (config: Config) => {
    const ctx: AppContext = {
      config,
      db: handle.db,
      dbHandle: handle,
      clock: fixedClock(NOW),
    };
    // grammY does not contact Telegram until an update is dispatched, so an
    // uninitialised bot is fine for testing the surrounding HTTP layer.
    return createApp(ctx, new Bot(BOT_TOKEN, { botInfo: undefined as never }), {
      state: { bot: 'ready', webhook: 'registered' },
    });
  };

  beforeAll(async () => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    for (const id of [OWNER_TELEGRAM_ID, STRANGER_TELEGRAM_ID]) {
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, id));
    }
  });

  afterAll(async () => {
    for (const id of [OWNER_TELEGRAM_ID, STRANGER_TELEGRAM_ID]) {
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, id));
    }
    await handle.close();
  });

  describe('GET /healthz', () => {
    it('answers without touching the database', async () => {
      const response = await buildApp(makeConfig()).request('/healthz');
      expect(response.status).toBe(200);
      expect(healthResponseSchema.parse(await response.json())).toMatchObject({
        status: 'ok',
        version: 'test',
      });
    });

    it('reports boot progress, so "the bot does nothing" is diagnosable from a URL', async () => {
      const ctx: AppContext = {
        config: makeConfig(),
        db: handle.db,
        dbHandle: handle,
        clock: fixedClock(NOW),
      };
      const app = createApp(ctx, new Bot(BOT_TOKEN, { botInfo: undefined as never }), {
        state: { bot: 'starting', webhook: 'rejected' },
      });

      const body = healthResponseSchema.parse(await (await app.request('/healthz')).json());
      expect(body.bot).toBe('starting');
      expect(body.webhook).toBe('rejected');
      // Still 200: the service is up and must keep passing Render's health
      // check while the bot is still coming up.
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /api/me', () => {
    it('rejects a request with no initData', async () => {
      const response = await buildApp(makeConfig()).request('/api/me');
      expect(response.status).toBe(401);
    });

    it('rejects initData signed with another bot token', async () => {
      const forged = signedInitData(OWNER_TELEGRAM_ID, '222222:not-our-token');
      const response = await buildApp(makeConfig()).request('/api/me', {
        headers: { Authorization: `tma ${forged}` },
      });
      expect(response.status).toBe(401);
    });

    it('creates the user on first contact and resolves today in their timezone', async () => {
      const response = await buildApp(makeConfig()).request('/api/me', {
        headers: { Authorization: `tma ${signedInitData(OWNER_TELEGRAM_ID)}` },
      });

      expect(response.status).toBe(200);
      // Parsing with the shared schema asserts the response still matches the
      // contract the Mini App compiles against.
      const body = meResponseSchema.parse(await response.json());
      expect(body.user.telegramId).toBe(OWNER_TELEGRAM_ID.toString());
      expect(body.user.timezone).toBe('Asia/Singapore');
      expect(body.user.currency).toBe('SGD');
      expect(body.user.monthlyBudgetCents).toBeNull();
      // 04:00 UTC is noon in Singapore, so today is the 27th in both — the
      // timezone-sensitive cases are covered in packages/core/src/time.test.ts.
      expect(body.today).toBe('2026-08-27');
    });

    it('is idempotent — a second call does not create a second user', async () => {
      const app = buildApp(makeConfig());
      const headers = { Authorization: `tma ${signedInitData(OWNER_TELEGRAM_ID)}` };
      const first = meResponseSchema.parse(
        await (await app.request('/api/me', { headers })).json(),
      );
      const second = meResponseSchema.parse(
        await (await app.request('/api/me', { headers })).json(),
      );
      expect(second.user.id).toBe(first.user.id);
    });

    it('refuses a valid signature from an account outside the allowlist', async () => {
      const app = buildApp(makeConfig({ allowedTelegramIds: new Set([OWNER_TELEGRAM_ID]) }));

      const allowed = await app.request('/api/me', {
        headers: { Authorization: `tma ${signedInitData(OWNER_TELEGRAM_ID)}` },
      });
      expect(allowed.status).toBe(200);

      const denied = await app.request('/api/me', {
        headers: { Authorization: `tma ${signedInitData(STRANGER_TELEGRAM_ID)}` },
      });
      expect(denied.status).toBe(403);
    });
  });

  describe('GET /api/categories', () => {
    it('returns the seeded defaults', async () => {
      const response = await buildApp(makeConfig()).request('/api/categories', {
        headers: { Authorization: `tma ${signedInitData(OWNER_TELEGRAM_ID)}` },
      });
      expect(response.status).toBe(200);

      const body = categoriesResponseSchema.parse(await response.json());
      const slugs = body.categories.map((c) => c.slug);
      expect(slugs).toContain('food');
      expect(slugs).toContain('salary');

      // PRD Q3: transfers are excluded from the budget by default.
      const transfers = body.categories.find((c) => c.slug === 'transfers');
      expect(transfers?.excludeFromBudget).toBe(true);
    });

    it('rejects an unauthenticated request', async () => {
      const response = await buildApp(makeConfig()).request('/api/categories');
      expect(response.status).toBe(401);
    });
  });

  describe('POST /telegram/webhook', () => {
    it('rejects a request without the secret header', async () => {
      const response = await buildApp(makeConfig()).request('/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 1 }),
      });
      expect(response.status).toBe(401);
    });

    it('rejects a request with the wrong secret', async () => {
      const response = await buildApp(makeConfig()).request('/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'not-the-secret',
        },
        body: JSON.stringify({ update_id: 1 }),
      });
      expect(response.status).toBe(401);
    });
  });

  describe('POST /tasks/tick', () => {
    it('rejects a request with no bearer token', async () => {
      const response = await buildApp(makeConfig()).request('/tasks/tick', { method: 'POST' });
      expect(response.status).toBe(401);
    });

    it('rejects a wrong bearer token', async () => {
      const response = await buildApp(makeConfig()).request('/tasks/tick', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-secret-wrong-secret' },
      });
      expect(response.status).toBe(401);
    });

    it('runs and reports what it did', async () => {
      const response = await buildApp(makeConfig()).request('/tasks/tick', {
        method: 'POST',
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        recurringMaterialised: 0,
        digestsSent: 0,
      });
    });

    it('is idempotent — running it twice changes nothing', async () => {
      const app = buildApp(makeConfig());
      const headers = { Authorization: `Bearer ${CRON_SECRET}` };
      const a = await app.request('/tasks/tick', { method: 'POST', headers });
      const b = await app.request('/tasks/tick', { method: 'POST', headers });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
    });
  });

  describe('unknown routes', () => {
    it('returns a structured 404', async () => {
      const response = await buildApp(makeConfig()).request('/nope');
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
    });
  });
});
