/**
 * Integration tests for the spaces API (PRD F12.2) — the Mini App switcher's
 * backend: list every space a user belongs to, and move between them.
 */

import { createHmac } from 'node:crypto';
import { Bot } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fixedClock } from '@spendlygo/core';
import {
  createDatabase,
  householdsRepo,
  schema,
  usersRepo,
  type DatabaseHandle,
} from '@spendlygo/db';
import { spacesResponseSchema } from '@spendlygo/shared';
import { createApp } from '../app.js';
import type { SpendlygoBot } from '../bot/index.js';
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const BOT_TOKEN = '111111:AAH-test-token-for-integration-tests';
const NOW = new Date('2026-08-27T04:00:00Z');

const OWNER = 920000000201n;
const PARTNER = 920000000202n;

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

describeIfDb('spaces API', () => {
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;
  let ctx: AppContext;

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
    for (const telegramId of [OWNER, PARTNER]) {
      const rows = await handle.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.telegramId, telegramId));
      for (const row of rows) {
        await handle.db.delete(schema.transactions).where(eq(schema.transactions.userId, row.id));
        await handle.db.delete(schema.households).where(eq(schema.households.createdBy, row.id));
      }
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, telegramId));
    }
  };

  beforeAll(async () => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    ctx = { config, db: handle.db, dbHandle: handle, clock: fixedClock(NOW) };
    const bot: SpendlygoBot = new Bot(BOT_TOKEN, { botInfo: undefined as never });
    app = createApp(ctx, bot, { state: { bot: 'ready', webhook: 'registered' } });
  });

  beforeEach(cleanUsers);

  afterAll(async () => {
    await cleanUsers();
    await handle.close();
  });

  describe('GET /api/spaces', () => {
    it('lists just the personal space for a fresh user', async () => {
      const body = spacesResponseSchema.parse(
        await json(await app.request('/api/spaces', { headers: auth(OWNER) })),
      );
      expect(body.spaces).toHaveLength(1);
      expect(body.spaces[0]).toMatchObject({ isPersonal: true, isActive: true });
    });

    it('lists both spaces once shared, active pointing at the shared one', async () => {
      const invite = await json(
        await app.request('/api/household/invite', { method: 'POST', headers: auth(OWNER) }),
      );
      const owner = await usersRepo.findByTelegramId(handle.db, OWNER);
      const partner = await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: PARTNER,
        timezone: 'Asia/Singapore',
      });
      await householdsRepo.joinByCode(handle.db, invite.code, partner.id);

      const body = spacesResponseSchema.parse(
        await json(await app.request('/api/spaces', { headers: auth(OWNER) })),
      );
      expect(body.spaces).toHaveLength(2);
      const shared = body.spaces.find((s) => !s.isPersonal);
      expect(shared?.isActive).toBe(true);
      expect(shared?.members.map((m) => m.userId).sort()).toEqual([owner?.id, partner.id].sort());
    });

    it('rejects an unauthenticated request', async () => {
      expect((await app.request('/api/spaces')).status).toBe(401);
    });
  });

  describe('POST /api/spaces/switch', () => {
    it('switches the active space to one the caller belongs to', async () => {
      const owner =
        (await usersRepo.findByTelegramId(handle.db, OWNER)) ??
        (await usersRepo.upsertByTelegramId(handle.db, {
          telegramId: OWNER,
          timezone: 'Asia/Singapore',
        }));
      const personal = await householdsRepo.personalSpaceOf(handle.db, owner.id);
      const shared = await householdsRepo.create(handle.db, owner.id); // becomes active

      const response = await app.request('/api/spaces/switch', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({ householdId: personal.id }),
      });
      expect(response.status).toBe(200);

      const body = spacesResponseSchema.parse(
        await json(await app.request('/api/spaces', { headers: auth(OWNER) })),
      );
      expect(body.spaces.find((s) => s.id === personal.id)?.isActive).toBe(true);
      expect(body.spaces.find((s) => s.id === shared.id)?.isActive).toBe(false);
    });

    it("rejects switching into a space the caller doesn't belong to", async () => {
      const partner = await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: PARTNER,
        timezone: 'Asia/Singapore',
      });
      const partnerSpace = await householdsRepo.create(handle.db, partner.id);

      const response = await app.request('/api/spaces/switch', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({ householdId: partnerSpace.id }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects an unauthenticated request', async () => {
      const response = await app.request('/api/spaces/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdId: '00000000-0000-4000-8000-000000000000' }),
      });
      expect(response.status).toBe(401);
    });
  });
});
