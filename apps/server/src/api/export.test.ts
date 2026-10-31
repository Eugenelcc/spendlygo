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
import {
  createDatabase,
  householdsRepo,
  schema,
  usersRepo,
  type DatabaseHandle,
} from '@spendlygo/db';
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

// ---------------------------------------------------------------------------
// B-032 Part 3 (F17): pay-cycle ranges and dated file names
// ---------------------------------------------------------------------------

const OCT_31 = new Date('2026-10-31T04:00:00Z'); // noon in Singapore
const CYCLE_OWNER = 910000000111n;
const CYCLE_OTHER = 910000000112n;

function authAt(telegramId: bigint, now: Date): Record<string, string> {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(now.getTime() / 1000) - 30),
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

describeIfDb('GET /api/export with pay cycles (F17)', () => {
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
    for (const telegramId of [CYCLE_OWNER, CYCLE_OTHER]) {
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

  beforeAll(() => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    const ctx: AppContext = {
      config,
      db: handle.db,
      dbHandle: handle,
      clock: fixedClock(OCT_31),
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

  const get = (telegramId: bigint, query = '') =>
    app.request(`/api/export${query}`, { headers: authAt(telegramId, OCT_31) });

  async function expense(telegramId: bigint, cents: number, occurredOn: string, note: string) {
    const response = await app.request('/api/transactions', {
      method: 'POST',
      headers: authAt(telegramId, OCT_31),
      body: JSON.stringify({ direction: 'out', amountCents: cents, occurredOn, note }),
    });
    expect(response.status).toBe(201);
  }

  /** Owner's October: S$100 on 5 Oct (note "early"), S$50 on 25 Oct (note "late"). */
  async function ownersOctober(startDay: number) {
    const user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: CYCLE_OWNER,
      timezone: 'Asia/Singapore',
    });
    const space = await householdsRepo.personalSpaceOf(handle.db, user.id);
    if (startDay !== 1) await householdsRepo.updateCycleStartDay(handle.db, space.id, startDay);
    await expense(CYCLE_OWNER, 10_000, '2026-10-05', 'early');
    await expense(CYCLE_OWNER, 5_000, '2026-10-25', 'late');
  }

  const disposition = (response: Response) => response.headers.get('content-disposition') ?? '';

  it('no range still exports everything, whatever the start day', async () => {
    await ownersOctober(20);
    const response = await get(CYCLE_OWNER);
    expect(response.status).toBe(200);
    expect(disposition(response)).toContain('spendlygo-all-time.csv');
    const text = await response.text();
    expect(text).toContain('early');
    expect(text).toContain('late');
  });

  it('cycle and last-cycle follow the start day and name the file by dates', async () => {
    await ownersOctober(20);

    const current = await get(CYCLE_OWNER, '?range=cycle');
    expect(current.status).toBe(200);
    expect(disposition(current)).toContain('spendlygo_2026-10-20_to_2026-11-19.csv');
    const currentText = await current.text();
    expect(currentText).toContain('late');
    expect(currentText).not.toContain('early');

    const last = await get(CYCLE_OWNER, '?range=last-cycle');
    expect(last.status).toBe(200);
    expect(disposition(last)).toContain('spendlygo_2026-09-20_to_2026-10-19.csv');
    const lastText = await last.text();
    expect(lastText).toContain('early');
    expect(lastText).not.toContain('late');
  });

  it('a custom from..to range is inclusive; reversed is a 400', async () => {
    await ownersOctober(20);
    await expense(CYCLE_OWNER, 100, '2026-10-24', 'edge-end');
    await expense(CYCLE_OWNER, 100, '2026-10-04', 'before');
    await expense(CYCLE_OWNER, 100, '2026-10-26', 'after');

    const response = await get(CYCLE_OWNER, '?range=2026-10-05..2026-10-24');
    expect(response.status).toBe(200);
    expect(disposition(response)).toContain('spendlygo_2026-10-05_to_2026-10-24.csv');
    const text = await response.text();
    expect(text).toContain('early'); // 5 Oct, first day
    expect(text).toContain('edge-end'); // 24 Oct, last day
    expect(text).not.toContain('before');
    expect(text).not.toContain('after');
    expect(text).not.toContain('late');

    expect((await get(CYCLE_OWNER, '?range=2026-10-24..2026-10-05')).status).toBe(400);
  });

  it("range=cycle never includes another user's transactions", async () => {
    await ownersOctober(20);
    // A stranger at start day 1, with their own October row.
    await expense(CYCLE_OTHER, 7_500, '2026-10-25', 'stranger note');

    for (const query of ['', '?range=cycle']) {
      const theirs = await (await get(CYCLE_OTHER, query)).text();
      expect(theirs).toContain('stranger note');
      expect(theirs).not.toContain('early');
      expect(theirs).not.toContain('late');
    }
    const mine = await (await get(CYCLE_OWNER, '?range=cycle')).text();
    expect(mine).not.toContain('stranger note');

    expect((await app.request('/api/export?range=cycle')).status).toBe(401);
  });
});
