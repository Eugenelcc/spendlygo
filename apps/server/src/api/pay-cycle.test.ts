/**
 * Integration tests for the F17 pay cycle on the API (B-032 Part 1,
 * P1-AC18 to AC23 and AC27). Written before the feature exists.
 *
 * "Owner's October": Asia/Singapore, clock 2026-10-31T04:00:00Z, budget
 * S$1,500, expenses of S$100 on 2026-10-05 and S$50 on 2026-10-25.
 *
 * GUARDRAILS.md section 13: unauthenticated and cross-user cases included.
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
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const BOT_TOKEN = '111111:AAH-test-token-for-integration-tests';
const OCT_31 = new Date('2026-10-31T04:00:00Z'); // noon in Singapore
const OCT_20_0030_SG = new Date('2026-10-19T16:30:00Z'); // 00:30 on 20 Oct in Singapore

const OWNER = 920000000001n;
const PARTNER = 920000000002n;
const STRANGER = 920000000003n;

const CYCLE_20 = {
  startDay: 20,
  start: '2026-10-20',
  end: '2026-11-19',
  days: 31,
  label: '20 Oct – 19 Nov',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(response: Response): Promise<any> {
  return response.json();
}

function auth(telegramId: bigint, now: Date = OCT_31): Record<string, string> {
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

describeIfDb('pay cycle API (F17)', () => {
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;
  let lateApp: ReturnType<typeof createApp>; // clock at 00:30 on 20 Oct, Singapore

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

  function makeApp(now: Date): ReturnType<typeof createApp> {
    const ctx: AppContext = {
      config,
      db: handle.db,
      dbHandle: handle,
      clock: fixedClock(now),
    };
    return createApp(ctx, new Bot(BOT_TOKEN, { botInfo: undefined as never }), {
      state: { bot: 'ready', webhook: 'registered' },
    });
  }

  const cleanUsers = async () => {
    for (const telegramId of [OWNER, PARTNER, STRANGER]) {
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
    app = makeApp(OCT_31);
    lateApp = makeApp(OCT_20_0030_SG);
  });

  beforeEach(cleanUsers);
  afterAll(async () => {
    await cleanUsers();
    await handle.close();
  });

  async function personalSpaceFor(telegramId: bigint) {
    const user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId,
      timezone: 'Asia/Singapore',
    });
    return { user, space: await householdsRepo.personalSpaceOf(handle.db, user.id) };
  }

  async function expense(
    target: ReturnType<typeof createApp>,
    telegramId: bigint,
    cents: number,
    occurredOn?: string,
    now: Date = OCT_31,
  ) {
    const response = await target.request('/api/transactions', {
      method: 'POST',
      headers: auth(telegramId, now),
      body: JSON.stringify({ direction: 'out', amountCents: cents, occurredOn }),
    });
    expect(response.status).toBe(201);
  }

  /** Owner's October: S$1,500 budget, S$100 on 5 Oct, S$50 on 25 Oct. */
  async function ownersOctober(startDay: number) {
    const { space } = await personalSpaceFor(OWNER);
    await householdsRepo.updateBudget(handle.db, space.id, 150_000);
    if (startDay !== 1) await householdsRepo.updateCycleStartDay(handle.db, space.id, startDay);
    await expense(app, OWNER, 10_000, '2026-10-05');
    await expense(app, OWNER, 5_000, '2026-10-25');
    return space;
  }

  describe('GET /api/today', () => {
    it("owner's example: day 20 counts from 20 Oct", async () => {
      await ownersOctober(20);
      const response = await app.request('/api/today', { headers: auth(OWNER) });
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.safeToSpend).toMatchObject({
        spentMonthToDateCents: 5000,
        dayOfMonth: 12,
        daysInMonth: 31,
        daysRemaining: 20,
        safeTodayCents: 7250,
      });
      expect(body.monthOut).toBe(5000);
      expect(body.cycle).toEqual(CYCLE_20);
    });

    it('day 1 is the calendar month, unchanged', async () => {
      await ownersOctober(1);
      const body = await json(await app.request('/api/today', { headers: auth(OWNER) }));
      expect(body.safeToSpend).toMatchObject({
        spentMonthToDateCents: 15000,
        dayOfMonth: 31,
        daysInMonth: 31,
        daysRemaining: 1,
        safeTodayCents: 135000,
      });
      expect(body.monthOut).toBe(15000);
      expect(body.cycle).toEqual({
        startDay: 1,
        start: '2026-10-01',
        end: '2026-10-31',
        days: 31,
        label: 'October',
      });
    });

    it('a 00:30 entry on the start day is in the new cycle', async () => {
      const { space } = await personalSpaceFor(OWNER);
      await householdsRepo.updateBudget(handle.db, space.id, 150_000);
      await householdsRepo.updateCycleStartDay(handle.db, space.id, 20);
      await expense(lateApp, OWNER, 4_000, '2026-10-19', OCT_20_0030_SG);
      await expense(lateApp, OWNER, 1_200, undefined, OCT_20_0030_SG);

      const body = await json(
        await lateApp.request('/api/today', { headers: auth(OWNER, OCT_20_0030_SG) }),
      );
      expect(body.today).toBe('2026-10-20');
      expect(body.cycle.start).toBe('2026-10-20');
      expect(body.safeToSpend.spentMonthToDateCents).toBe(1200);
      expect(body.safeToSpend.daysRemaining).toBe(31);
    });

    it("a shared space's members share its cycle; switching spaces switches cycle", async () => {
      const creator = await personalSpaceFor(OWNER);
      const partner = await personalSpaceFor(PARTNER);
      const shared = await householdsRepo.create(handle.db, creator.user.id);
      const invite = await householdsRepo.createInvite(handle.db, shared.id, creator.user.id);
      await householdsRepo.joinByCode(handle.db, invite.code, partner.user.id);
      await householdsRepo.updateBudget(handle.db, shared.id, 150_000);
      await householdsRepo.updateCycleStartDay(handle.db, shared.id, 20);

      const mine = await json(await app.request('/api/today', { headers: auth(OWNER) }));
      const theirs = await json(await app.request('/api/today', { headers: auth(PARTNER) }));
      expect(mine.cycle.startDay).toBe(20);
      expect(theirs.cycle.startDay).toBe(20);
      expect(theirs.safeToSpend.safeTodayCents).toBe(mine.safeToSpend.safeTodayCents);

      const switched = await app.request('/api/spaces/switch', {
        method: 'POST',
        headers: auth(PARTNER),
        body: JSON.stringify({ householdId: partner.space.id }),
      });
      expect(switched.status).toBe(200);
      const after = await json(await app.request('/api/today', { headers: auth(PARTNER) }));
      expect(after.cycle.startDay).toBe(1);
    });

    it("rejects unauthenticated, and a stranger never gets another space's cycle", async () => {
      await ownersOctober(20);

      const anon = await app.request('/api/today');
      expect(anon.status).toBe(401);

      const stranger = await app.request('/api/today', { headers: auth(STRANGER) });
      expect(stranger.status).toBe(200);
      const body = await json(stranger);
      expect(body.cycle.startDay).toBe(1);
      expect(body.safeToSpend.spentMonthToDateCents).toBe(0);
    });
  });

  describe('GET /api/me', () => {
    it('returns the current cycle', async () => {
      await ownersOctober(20);
      const body = await json(await app.request('/api/me', { headers: auth(OWNER) }));
      expect(body.cycle).toEqual(CYCLE_20);
    });

    it('rejects unauthenticated access', async () => {
      expect((await app.request('/api/me')).status).toBe(401);
    });
  });

  describe('PATCH /api/settings', () => {
    it('an unknown key is a 400 and changes nothing (strict schema)', async () => {
      await ownersOctober(1);
      const response = await app.request('/api/settings', {
        method: 'PATCH',
        headers: auth(OWNER),
        body: JSON.stringify({ monthlyBudgetCents: 100_000, colour: 'blue' }),
      });
      expect(response.status).toBe(400);

      const me = await json(await app.request('/api/me', { headers: auth(OWNER) }));
      expect(me.user.monthlyBudgetCents).toBe(150_000);
    });
  });
});
