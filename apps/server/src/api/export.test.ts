/**
 * Integration tests for CSV export (PRD F8).
 *
 * GUARDRAILS.md section 13: every route is tested for unauthenticated AND
 * cross-user access.
 */

import { createHmac } from 'node:crypto';
import { Bot } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fixedClock } from '@spendlygo/core';
import { createDatabase, schema, type DatabaseHandle } from '@spendlygo/db';
import { createApp } from '../app.js';
import type { SpendlygoBot } from '../bot/index.js';
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const BOT_TOKEN = '111111:AAH-test-token-for-integration-tests';
const NOW = new Date('2026-08-27T04:00:00Z'); // noon in Singapore

const OWNER = 910000000101n;
const OTHER = 910000000102n;

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

describeIfDb('GET /api/export', () => {
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
    for (const telegramId of [OWNER, OTHER]) {
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

    const ctx: AppContext = {
      config,
      db: handle.db,
      dbHandle: handle,
      clock: fixedClock(NOW),
    };
    const bot: SpendlygoBot = new Bot(BOT_TOKEN, { botInfo: undefined as never });
    app = createApp(ctx, bot, {
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

  it('returns a CSV with the PRD F8.3 header and a matching content type', async () => {
    await post(OWNER, { direction: 'out', amountCents: 1250, note: 'lunch' });

    const response = await app.request('/api/export', { headers: auth(OWNER) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toContain('spendlygo-all-time.csv');

    const text = await response.text();
    const lines = text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('date,direction,amount_sgd,category,note,source,has_photo,created_at');
    expect(lines[1]).toContain('12.50');
    expect(lines[1]).toContain('lunch');
  });

  it('filters by year and by month', async () => {
    await post(OWNER, { direction: 'out', amountCents: 1000 });

    const year = await (
      await app.request('/api/export?range=2026', { headers: auth(OWNER) })
    ).text();
    expect(year.split('\r\n').length).toBe(3); // header + 1 row + trailing blank

    const wrongYear = await (
      await app.request('/api/export?range=2025', { headers: auth(OWNER) })
    ).text();
    expect(wrongYear.split('\r\n').length).toBe(2); // header + trailing blank only

    const month = await (
      await app.request('/api/export?range=2026-08', { headers: auth(OWNER) })
    ).text();
    expect(month.split('\r\n').length).toBe(3);

    const wrongMonth = await (
      await app.request('/api/export?range=2026-07', { headers: auth(OWNER) })
    ).text();
    expect(wrongMonth.split('\r\n').length).toBe(2);
  });

  it('rejects a malformed range', async () => {
    const response = await app.request('/api/export?range=not-a-range', { headers: auth(OWNER) });
    expect(response.status).toBe(400);
  });

  it('rejects an unauthenticated request', async () => {
    expect((await app.request('/api/export')).status).toBe(401);
  });

  it("never includes another user's transactions", async () => {
    await post(OWNER, { direction: 'out', amountCents: 5000, note: 'owner secret' });
    await post(OTHER, { direction: 'out', amountCents: 7500, note: 'other secret' });

    const ownerCsv = await (await app.request('/api/export', { headers: auth(OWNER) })).text();
    expect(ownerCsv).toContain('owner secret');
    expect(ownerCsv).not.toContain('other secret');

    const otherCsv = await (await app.request('/api/export', { headers: auth(OTHER) })).text();
    expect(otherCsv).toContain('other secret');
    expect(otherCsv).not.toContain('owner secret');
  });
});
