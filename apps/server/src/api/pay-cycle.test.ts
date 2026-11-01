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
import { Bot, GrammyError } from 'grammy';
import type { BotContext } from '../bot/middleware.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { logger, setLogLevel } from '../logger.js';

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

function auth(telegramId: bigint, now: Date = OCT_31, firstName = 'Test'): Record<string, string> {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(now.getTime() / 1000) - 30),
    user: JSON.stringify({ id: Number(telegramId), first_name: firstName }),
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

  function makeApp(
    now: Date,
    bot: Bot<BotContext> = new Bot<BotContext>(BOT_TOKEN, { botInfo: undefined as never }),
    sleep?: (ms: number) => Promise<void>,
  ): ReturnType<typeof createApp> {
    const ctx: AppContext = {
      config,
      db: handle.db,
      dbHandle: handle,
      clock: fixedClock(now),
    };
    return createApp(ctx, bot, {
      state: { bot: 'ready', webhook: 'registered' },
      ...(sleep ? { sleep } : {}),
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

  async function personalSpaceFor(telegramId: bigint, firstName?: string) {
    const user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId,
      timezone: 'Asia/Singapore',
      ...(firstName ? { firstName } : {}),
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

    it('also returns the previous cycle', async () => {
      await ownersOctober(20);
      const body = await json(await app.request('/api/me', { headers: auth(OWNER) }));
      expect(body.previousCycle).toEqual({
        startDay: 20,
        start: '2026-09-20',
        end: '2026-10-19',
        days: 30,
        label: '20 Sep – 19 Oct',
      });
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

    // --- Part 4 (B-032, P4-AC1 to AC5, AC11, AC12, AC14, AC15) ----------------

    const patch = (body: unknown, telegramId: bigint = OWNER, firstName?: string) =>
      app.request('/api/settings', {
        method: 'PATCH',
        headers: auth(telegramId, OCT_31, firstName),
        body: JSON.stringify(body),
      });

    const meOf = async (telegramId: bigint) =>
      json(await app.request('/api/me', { headers: auth(telegramId) }));

    /** A shared space: OWNER created it, PARTNER ("Priya") joined; start day 1. */
    async function sharedSpace() {
      const creator = await personalSpaceFor(OWNER, 'Owen');
      const partner = await personalSpaceFor(PARTNER, 'Priya');
      const shared = await householdsRepo.create(handle.db, creator.user.id);
      const invite = await householdsRepo.createInvite(handle.db, shared.id, creator.user.id);
      await householdsRepo.joinByCode(handle.db, invite.code, partner.user.id);
      await householdsRepo.updateBudget(handle.db, shared.id, 150_000);
      return { creator, partner, shared };
    }

    /** An app whose bot.api.sendMessage is a mock, as alerts.test.ts does. */
    function appWithBot(sleep?: (ms: number) => Promise<void>) {
      const bot = new Bot<BotContext>(BOT_TOKEN, { botInfo: undefined as never });
      const sendMessage = vi.fn().mockResolvedValue({});
      bot.api.sendMessage = sendMessage as never;
      return { target: makeApp(OCT_31, bot, sleep), sendMessage };
    }

    const noticeRequest = (target: ReturnType<typeof createApp>, day = 20) =>
      target.request('/api/settings', {
        method: 'PATCH',
        headers: auth(PARTNER, OCT_31, 'Priya'),
        body: JSON.stringify({ cycleStartDay: day }),
      });

    const grammyError = (code: number, description: string, retryAfter?: number) =>
      new GrammyError(
        `Call to 'sendMessage' failed!`,
        {
          ok: false,
          error_code: code,
          description,
          ...(retryAfter === undefined ? {} : { parameters: { retry_after: retryAfter } }),
        },
        'sendMessage',
        {},
      );

    it("owner's example: setting day 20 on 31 Oct moves Today to 20 Oct – 19 Nov", async () => {
      await ownersOctober(1);
      const response = await patch({ cycleStartDay: 20 });
      expect(response.status).toBe(200);
      expect((await json(response)).user.cycleStartDay).toBe(20);

      const body = await json(await app.request('/api/today', { headers: auth(OWNER) }));
      expect(body.safeToSpend).toMatchObject({
        spentMonthToDateCents: 5000,
        dayOfMonth: 12,
        daysInMonth: 31,
        daysRemaining: 20,
        safeTodayCents: 7250,
      });
      expect(body.cycle).toEqual(CYCLE_20);
    });

    it('rejects 0, 32, 1.5 and "20" without changing anything', async () => {
      const { space } = await personalSpaceFor(OWNER);
      await householdsRepo.updateCycleStartDay(handle.db, space.id, 7);
      for (const bad of [0, 32, 1.5, '20']) {
        const response = await patch({ cycleStartDay: bad });
        expect(response.status, String(bad)).toBe(400);
      }
      expect((await meOf(OWNER)).cycle.startDay).toBe(7);
    });

    it('either member of a shared space can change it', async () => {
      await sharedSpace();
      const response = await patch({ cycleStartDay: 20 }, PARTNER); // not the creator
      expect(response.status).toBe(200);
      expect((await meOf(OWNER)).cycle.startDay).toBe(20);
      expect((await meOf(PARTNER)).cycle.startDay).toBe(20);
    });

    it('changes only the active space', async () => {
      const { partner } = await sharedSpace();
      expect((await patch({ cycleStartDay: 20 }, PARTNER)).status).toBe(200);

      const switched = await app.request('/api/spaces/switch', {
        method: 'POST',
        headers: auth(PARTNER),
        body: JSON.stringify({ householdId: partner.space.id }),
      });
      expect(switched.status).toBe(200);
      expect((await meOf(PARTNER)).cycle.startDay).toBe(1);
    });

    it('a householdId in the body is a 400; unauthenticated is a 401', async () => {
      const { space: ownerSpace } = await personalSpaceFor(OWNER);
      const { space: strangerSpace } = await personalSpaceFor(STRANGER);

      const cross = await patch({ cycleStartDay: 20, householdId: ownerSpace.id }, STRANGER);
      expect(cross.status).toBe(400);
      expect((await householdsRepo.findById(handle.db, ownerSpace.id))?.cycleStartDay).toBe(1);
      expect((await householdsRepo.findById(handle.db, strangerSpace.id))?.cycleStartDay).toBe(1);

      const anon = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycleStartDay: 20 }),
      });
      expect(anon.status).toBe(401);
      expect((await householdsRepo.findById(handle.db, ownerSpace.id))?.cycleStartDay).toBe(1);
    });

    it("a partner's change sends one message to each other member, and none when nothing changed", async () => {
      await sharedSpace();
      const { target, sendMessage } = appWithBot();

      expect((await noticeRequest(target)).status).toBe(200);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        String(OWNER),
        "Priya set this shared space's budget month to start on the 20th. This cycle: 20 Oct – 19 Nov.",
      );

      expect((await noticeRequest(target)).status).toBe(200); // same value again
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('a personal space change messages nobody', async () => {
      await personalSpaceFor(OWNER, 'Owen');
      const { target, sendMessage } = appWithBot();
      const response = await target.request('/api/settings', {
        method: 'PATCH',
        headers: auth(OWNER, OCT_31, 'Owen'),
        body: JSON.stringify({ cycleStartDay: 20 }),
      });
      expect(response.status).toBe(200);
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('a blocked partner never fails the change', async () => {
      await sharedSpace();
      const { target, sendMessage } = appWithBot();
      sendMessage.mockRejectedValue(grammyError(403, 'Forbidden: bot was blocked by the user'));
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const response = await noticeRequest(target);
      expect(response.status).toBe(200);
      expect((await json(response)).user.cycleStartDay).toBe(20);
      expect(sendMessage).toHaveBeenCalledTimes(1); // nothing retried
      expect((await meOf(PARTNER)).cycle.startDay).toBe(20);
      expect(warn).toHaveBeenCalledWith(
        'settings.cycle_notify_failed',
        expect.objectContaining({ userId: expect.any(String) }),
      );
      warn.mockRestore();
    });

    it('a 429 is retried once after retry_after', async () => {
      await sharedSpace();
      const sleep = vi.fn().mockResolvedValue(undefined);
      const { target, sendMessage } = appWithBot(sleep);
      sendMessage
        .mockRejectedValueOnce(grammyError(429, 'Too Many Requests: retry after 1', 1))
        .mockResolvedValue({});

      const response = await noticeRequest(target);
      expect(response.status).toBe(200);
      expect(sleep).toHaveBeenCalledWith(1000);
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });
  });
  // --- Part 2 (B-032, P2-AC1 to AC5): the Stats month view -------------------

  describe('GET /api/stats', () => {
    const stats = (query: string, telegramId: bigint = OWNER) =>
      app.request(`/api/stats?${query}`, { headers: auth(telegramId) });

    it('month view is the day-20 cycle with 31 day buckets', async () => {
      await ownersOctober(20);
      const response = await stats('period=month');
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.from).toBe('2026-10-20');
      expect(body.to).toBe('2026-11-19');
      expect(body.label).toBe('20 Oct – 19 Nov');
      expect(body.outCents).toBe(5000);
      expect(body.previousOutCents).toBe(10_000); // 20 Sep - 19 Oct
      expect(body.series).toHaveLength(31);
      expect(body.series[0]).toMatchObject({ key: '2026-10-20', label: '20' });
      expect(body.series[30]).toMatchObject({ key: '2026-11-19', label: '19' });
    });

    it('day 1 month view is unchanged', async () => {
      await ownersOctober(1);
      const body = await json(await stats('period=month'));
      expect(body.from).toBe('2026-10-01');
      expect(body.to).toBe('2026-10-31');
      expect(body.label).toBe('October 2026');
      expect(body.outCents).toBe(15_000);
      expect(body.series).toHaveLength(31);
      expect(body.series.map((point: { label: string }) => point.label)).toEqual(
        Array.from({ length: 31 }, (_, index) => String(index + 1)),
      );
    });

    it('anchors either side of a cycle step exactly one cycle, re-grouped by the current start day', async () => {
      await ownersOctober(20);

      // The day before `from` of the current cycle: the previous cycle, which
      // now holds the S$100 spent on 5 Oct (decision 5, history is re-grouped).
      const before = await json(await stats('period=month&anchor=2026-10-05'));
      expect(before.from).toBe('2026-09-20');
      expect(before.to).toBe('2026-10-19');
      expect(before.outCents).toBe(10_000);

      // The day after `to`: the next cycle.
      const after = await json(await stats('period=month&anchor=2026-11-20'));
      expect(after.from).toBe('2026-11-20');
      expect(after.to).toBe('2026-12-19');
      expect(after.outCents).toBe(0);
    });

    it('rejects unauthenticated and a bad anchor; a stranger sees only their own month', async () => {
      await ownersOctober(20);

      expect((await app.request('/api/stats?period=month')).status).toBe(401);
      expect((await stats('period=month&anchor=2026-02-30')).status).toBe(400);

      const stranger = await stats('period=month', STRANGER);
      expect(stranger.status).toBe(200);
      const body = await json(stranger);
      expect(body.from).toBe('2026-10-01');
      expect(body.to).toBe('2026-10-31');
      expect(body.outCents).toBe(0);
      expect(body.count).toBe(0);
    });

    it('the year view stays the calendar year with a day-20 cycle', async () => {
      await ownersOctober(20);
      const body = await json(await stats('period=year'));
      expect(body.from).toBe('2026-01-01');
      expect(body.to).toBe('2026-12-31');
      expect(body.label).toBe('2026');
      expect(body.series).toHaveLength(12);
      expect(body.outCents).toBe(15_000);
    });
  });
});
