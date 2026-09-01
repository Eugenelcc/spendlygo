/**
 * Integration tests for the calendar heatmap endpoint.
 *
 * GUARDRAILS.md section 13: unauthenticated and cross-user access get their
 * own tests.
 */

import { createHmac } from 'node:crypto';
import { Bot } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fixedClock } from '@spendlygo/core';
import { createDatabase, schema, type DatabaseHandle } from '@spendlygo/db';
import { heatmapResponseSchema } from '@spendlygo/shared';
import { createApp } from '../app.js';
import type { SpendlygoBot } from '../bot/index.js';
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const BOT_TOKEN = '111111:AAH-test-token-for-integration-tests';
const NOW = new Date('2026-08-27T04:00:00Z'); // noon in Singapore
const TODAY = '2026-08-27';

const OWNER = 930000000301n;

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

describeIfDb('GET /api/stats/heatmap', () => {
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
    const rows = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.telegramId, OWNER));
    for (const row of rows) {
      await handle.db.delete(schema.transactions).where(eq(schema.transactions.userId, row.id));
      await handle.db.delete(schema.households).where(eq(schema.households.createdBy, row.id));
    }
    await handle.db.delete(schema.users).where(eq(schema.users.telegramId, OWNER));
  };

  beforeAll(async () => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    const ctx: AppContext = { config, db: handle.db, dbHandle: handle, clock: fixedClock(NOW) };
    const bot: SpendlygoBot = new Bot(BOT_TOKEN, { botInfo: undefined as never });
    app = createApp(ctx, bot, { state: { bot: 'ready', webhook: 'registered' } });
  });

  beforeEach(cleanUsers);

  afterAll(async () => {
    await cleanUsers();
    await handle.close();
  });

  const post = (body: unknown) =>
    app.request('/api/transactions', {
      method: 'POST',
      headers: auth(OWNER),
      body: JSON.stringify(body),
    });

  it('covers exactly 371 days ending today, oldest first', async () => {
    const body = heatmapResponseSchema.parse(
      await json(await app.request('/api/stats/heatmap', { headers: auth(OWNER) })),
    );
    expect(body.days).toHaveLength(371);
    expect(body.days[0]?.day).toBe('2025-08-22'); // 370 days before TODAY
    expect(body.days.at(-1)?.day).toBe(TODAY);
    expect(body.to).toBe(TODAY);
  });

  it('fills every day with zero except the ones actually logged', async () => {
    await post({ direction: 'out', amountCents: 1250, occurredOn: TODAY });

    const body = heatmapResponseSchema.parse(
      await json(await app.request('/api/stats/heatmap', { headers: auth(OWNER) })),
    );
    const zeroDays = body.days.filter((d) => d.outCents === 0);
    expect(zeroDays).toHaveLength(370);
    expect(body.days.find((d) => d.day === TODAY)?.outCents).toBe(1250);
  });

  it('sums more than one entry on the same day', async () => {
    await post({ direction: 'out', amountCents: 1000, occurredOn: TODAY });
    await post({ direction: 'out', amountCents: 500, occurredOn: TODAY });

    const body = heatmapResponseSchema.parse(
      await json(await app.request('/api/stats/heatmap', { headers: auth(OWNER) })),
    );
    expect(body.days.find((d) => d.day === TODAY)?.outCents).toBe(1500);
  });

  it("never includes another user's spending", async () => {
    const OTHER = 930000000302n;
    await handle.db.delete(schema.users).where(eq(schema.users.telegramId, OTHER));
    await post({ direction: 'out', amountCents: 9999, occurredOn: TODAY });

    const otherBody = heatmapResponseSchema.parse(
      await json(await app.request('/api/stats/heatmap', { headers: auth(OTHER) })),
    );
    expect(otherBody.days.every((d) => d.outCents === 0)).toBe(true);

    const rows = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.telegramId, OTHER));
    for (const row of rows) {
      await handle.db.delete(schema.transactions).where(eq(schema.transactions.userId, row.id));
      await handle.db.delete(schema.households).where(eq(schema.households.createdBy, row.id));
    }
    await handle.db.delete(schema.users).where(eq(schema.users.telegramId, OTHER));
  });

  it('rejects an unauthenticated request', async () => {
    expect((await app.request('/api/stats/heatmap')).status).toBe(401);
  });
});
