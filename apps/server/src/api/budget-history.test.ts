/**
 * Integration tests for budget history on the API (B-032 Part 5): the write
 * path (PATCH /api/settings) and the Stats month view's budget line.
 * Written before the feature exists.
 *
 * "Owner's history" (spec scenario): Asia/Singapore, clock 2026-10-31T04:00:00Z,
 * start day 20, one personal space with changes (1970-01-01, 35 000) and
 * (2026-03-05, 50 000), expenses $310 on 2026-02-01, $525 on 2026-03-01,
 * $100 on 2026-10-05 and $50 on 2026-10-25. The epoch row stands in for the
 * migration's seed (proved by budget-periods-migration.test.ts).
 *
 * GUARDRAILS.md section 13: unauthenticated and cross-user cases included.
 */

import { createHmac } from 'node:crypto';
import { Bot } from 'grammy';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BUDGET_HISTORY_EPOCH, fixedClock } from '@spendlygo/core';
import { statsResponseSchema } from '@spendlygo/shared';
import {
  budgetPeriodsRepo,
  createDatabase,
  householdsRepo,
  schema,
  usersRepo,
  type DatabaseHandle,
} from '@spendlygo/db';
import type { BotContext } from '../bot/middleware.js';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const BOT_TOKEN = '111111:AAH-test-token-for-integration-tests';
const OCT_31 = new Date('2026-10-31T04:00:00Z'); // noon in Singapore
const OCT_20_0030_SG = new Date('2026-10-19T16:30:00Z'); // 00:30 on 20 Oct in Singapore
const MAR_15_2028 = new Date('2028-03-15T04:00:00Z');
const NOV_1_0130_SG = new Date('2026-10-31T17:30:00Z'); // 01:30 on 1 Nov in Singapore

const OWNER = 930000000001n;
const PARTNER = 930000000002n;
const STRANGER = 930000000003n;

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

describeIfDb('budget history API (F17 Part 5)', () => {
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

  function makeApp(now: Date): ReturnType<typeof createApp> {
    const ctx: AppContext = { config, db: handle.db, dbHandle: handle, clock: fixedClock(now) };
    return createApp(ctx, new Bot<BotContext>(BOT_TOKEN, { botInfo: undefined as never }), {
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
  });
  beforeEach(cleanUsers);
  afterAll(async () => {
    await cleanUsers();
    await handle.close();
  });

  async function personalSpaceFor(telegramId: bigint, timezone = 'Asia/Singapore') {
    const user = await usersRepo.upsertByTelegramId(handle.db, { telegramId, timezone });
    return { user, space: await householdsRepo.personalSpaceOf(handle.db, user.id) };
  }

  async function post(
    target: ReturnType<typeof createApp>,
    telegramId: bigint,
    now: Date,
    body: Record<string, unknown>,
  ) {
    const response = await target.request('/api/transactions', {
      method: 'POST',
      headers: auth(telegramId, now),
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
  }

  const expense = (
    cents: number,
    occurredOn: string,
    extra: Record<string, unknown> = {},
    target = app,
    telegramId = OWNER,
    now = OCT_31,
  ) =>
    post(target, telegramId, now, { direction: 'out', amountCents: cents, occurredOn, ...extra });

  /** Owner's history, with start day `startDay` (default 20). */
  async function ownersHistory(startDay = 20) {
    const { space } = await personalSpaceFor(OWNER);
    await householdsRepo.updateBudget(handle.db, space.id, 35_000, BUDGET_HISTORY_EPOCH);
    await householdsRepo.updateBudget(handle.db, space.id, 50_000, '2026-03-05');
    if (startDay !== 1) await householdsRepo.updateCycleStartDay(handle.db, space.id, startDay);
    await expense(31_000, '2026-02-01');
    await expense(52_500, '2026-03-01');
    await expense(10_000, '2026-10-05');
    await expense(5_000, '2026-10-25');
    return space;
  }

  const stats = (query: string, telegramId: bigint = OWNER, target = app, now = OCT_31) =>
    target.request(`/api/stats?${query}`, { headers: auth(telegramId, now) });

  const changesOf = async (spaceId: string) =>
    (await budgetPeriodsRepo.listForSpace(handle.db, spaceId)).map((row) => ({
      effectiveFrom: row.effectiveFrom,
      budgetCents: row.budgetCents,
    }));

  const patchBudget = (
    cents: number | null,
    telegramId: bigint = OWNER,
    target = app,
    now = OCT_31,
  ) =>
    target.request('/api/settings', {
      method: 'PATCH',
      headers: auth(telegramId, now),
      body: JSON.stringify({ monthlyBudgetCents: cents }),
    });

  async function sharedSpace(creatorTz = 'Asia/Singapore') {
    const creator = await personalSpaceFor(OWNER, creatorTz);
    const partner = await personalSpaceFor(PARTNER);
    const shared = await householdsRepo.create(handle.db, creator.user.id);
    const invite = await householdsRepo.createInvite(handle.db, shared.id, creator.user.id);
    await householdsRepo.joinByCode(handle.db, invite.code, partner.user.id);
    return { creator, partner, shared };
  }

  describe('PATCH /api/settings', () => {
    it('a change at 00:30 in Singapore is dated that Singapore day', async () => {
      const { space } = await personalSpaceFor(OWNER);
      await householdsRepo.updateBudget(handle.db, space.id, 35_000, BUDGET_HISTORY_EPOCH);
      await householdsRepo.updateBudget(handle.db, space.id, 50_000, '2026-03-05');
      const late = makeApp(OCT_20_0030_SG);

      const response = await patchBudget(60_000, OWNER, late, OCT_20_0030_SG);
      expect(response.status).toBe(200);

      const changes = await changesOf(space.id);
      expect(changes).toContainEqual({ effectiveFrom: '2026-10-20', budgetCents: 60_000 });
      expect(changes.map((c) => c.effectiveFrom)).not.toContain('2026-10-19');
    });

    it('a shared space keeps one history, whichever member changes it', async () => {
      const { creator, partner, shared } = await sharedSpace();
      await householdsRepo.updateBudget(handle.db, shared.id, 100_000, BUDGET_HISTORY_EPOCH);
      await expense(2_000, '2026-10-31');

      expect((await patchBudget(150_000, PARTNER)).status).toBe(200);
      expect((await patchBudget(150_000, OWNER)).status).toBe(200); // unchanged: a no-op

      expect(await changesOf(shared.id)).toEqual([
        { effectiveFrom: '1970-01-01', budgetCents: 100_000 },
        { effectiveFrom: '2026-10-31', budgetCents: 150_000 },
      ]);
      expect(await changesOf(creator.space.id)).toEqual([]);
      expect(await changesOf(partner.space.id)).toEqual([]);

      const body = await json(await stats('period=month'));
      expect(body.budget.budgetCents).toBe(150_000);
    });

    it('removing the budget hides the line for the current cycle', async () => {
      const space = await ownersHistory();
      expect((await patchBudget(null)).status).toBe(200);

      expect(await changesOf(space.id)).toContainEqual({
        effectiveFrom: '2026-10-31',
        budgetCents: null,
      });
      const body = await json(await stats('period=month'));
      expect(body.budget ?? null).toBeNull();
    });
  });

  describe('GET /api/stats', () => {
    it("owner's example: 20 Jan – 19 Feb shows the $350 that applied, $40 under", async () => {
      await ownersHistory();
      const body = await json(await stats('period=month&anchor=2026-02-01'));
      expect(body.from).toBe('2026-01-20');
      expect(body.to).toBe('2026-02-19');
      expect(body.budget).toEqual({
        budgetCents: 35_000,
        spentCents: 31_000,
        status: 'under',
        differenceCents: 4_000,
        isCurrent: false,
      });
    });

    it('a finished cycle with a mid-cycle change shows the last budget, $25 over', async () => {
      await ownersHistory();
      const body = await json(await stats('period=month&anchor=2026-03-01'));
      expect(body.from).toBe('2026-02-20');
      expect(body.to).toBe('2026-03-19');
      expect(body.budget).toEqual({
        budgetCents: 50_000,
        spentCents: 52_500,
        status: 'over',
        differenceCents: 2_500,
        isCurrent: false,
      });
    });

    it('the current cycle shows the live budget and keeps every Part 2 field', async () => {
      await ownersHistory();
      const body = await json(await stats('period=month'));
      expect(body.budget).toEqual({
        budgetCents: 50_000,
        spentCents: 5_000,
        status: 'under',
        differenceCents: 45_000,
        isCurrent: true,
      });
      expect(body.from).toBe('2026-10-20');
      expect(body.to).toBe('2026-11-19');
      expect(body.label).toBe('20 Oct – 19 Nov');
      expect(body.outCents).toBe(5_000);
      expect(body.previousOutCents).toBe(10_000);
      expect(body.series).toHaveLength(31);
    });

    it('after a start-day change each cycle still finds its own budget', async () => {
      const space = await ownersHistory();
      await householdsRepo.updateCycleStartDay(handle.db, space.id, 1);

      const march = await json(await stats('period=month&anchor=2026-03-01'));
      expect(march.from).toBe('2026-03-01');
      expect(march.to).toBe('2026-03-31');
      expect(march.budget.budgetCents).toBe(50_000);

      const february = await json(await stats('period=month&anchor=2026-02-10'));
      expect(february.from).toBe('2026-02-01');
      expect(february.to).toBe('2026-02-28');
      expect(february.budget.budgetCents).toBe(35_000);
    });

    it('a change on a cycle boundary in February and leap February', async () => {
      const later = makeApp(MAR_15_2028);
      const { space } = await personalSpaceFor(OWNER);
      await householdsRepo.updateBudget(handle.db, space.id, 35_000, BUDGET_HISTORY_EPOCH);
      await householdsRepo.updateBudget(handle.db, space.id, 50_000, '2026-02-28');
      await householdsRepo.updateBudget(handle.db, space.id, 60_000, '2028-02-29');
      await householdsRepo.updateCycleStartDay(handle.db, space.id, 31);
      const put = (cents: number, day: string) =>
        expense(cents, day, {}, later, OWNER, MAR_15_2028);
      await put(1_000, '2026-02-27');
      await put(1_000, '2026-02-28');

      const first = await json(
        await stats('period=month&anchor=2026-02-27', OWNER, later, MAR_15_2028),
      );
      expect([first.from, first.to]).toEqual(['2026-01-31', '2026-02-27']);
      expect(first.budget.budgetCents).toBe(35_000); // the change falls on the next cycle's first day

      const second = await json(
        await stats('period=month&anchor=2026-02-28', OWNER, later, MAR_15_2028),
      );
      expect([second.from, second.to]).toEqual(['2026-02-28', '2026-03-30']);
      expect(second.budget.budgetCents).toBe(50_000);

      await householdsRepo.updateCycleStartDay(handle.db, space.id, 1);
      await put(1_000, '2028-02-15');
      const leap = await json(
        await stats('period=month&anchor=2028-02-15', OWNER, later, MAR_15_2028),
      );
      expect([leap.from, leap.to]).toEqual(['2028-02-01', '2028-02-29']);
      expect(leap.budget.budgetCents).toBe(60_000);
    });

    it('cycles ending after a removal show no budget', async () => {
      const space = await ownersHistory();
      await householdsRepo.updateBudget(handle.db, space.id, null, '2026-06-01');
      await expense(1_000, '2026-06-25');
      await expense(1_000, '2026-06-05');

      for (const anchor of ['2026-06-25', '2026-06-05']) {
        const body = await json(await stats(`period=month&anchor=${anchor}`));
        expect(body.count).toBeGreaterThan(0);
        expect(body.budget ?? null).toBeNull();
      }
    });

    it('the seeded budget applies from the beginning', async () => {
      const { space } = await personalSpaceFor(OWNER);
      await householdsRepo.updateBudget(handle.db, space.id, 35_000, BUDGET_HISTORY_EPOCH);
      await expense(1_000, '2024-01-05');

      const body = await json(await stats('period=month&anchor=2024-01-05'));
      expect(body.budget.budgetCents).toBe(35_000);
    });

    it('a $0 budget is over or on, never hidden', async () => {
      const { space } = await personalSpaceFor(OWNER);
      await householdsRepo.updateBudget(handle.db, space.id, 0, BUDGET_HISTORY_EPOCH);
      await expense(1_200, '2026-05-05');
      await post(app, OWNER, OCT_31, {
        direction: 'in',
        amountCents: 5_000,
        occurredOn: '2026-06-05',
      });

      const spent = await json(await stats('period=month&anchor=2026-05-05'));
      expect(spent.budget).toEqual({
        budgetCents: 0,
        spentCents: 1_200,
        status: 'over',
        differenceCents: 1_200,
        isCurrent: false,
      });
      const incomeOnly = await json(await stats('period=month&anchor=2026-06-05'));
      expect(incomeOnly.budget).toEqual({
        budgetCents: 0,
        spentCents: 0,
        status: 'on',
        differenceCents: 0,
        isCurrent: false,
      });
    });

    it('day and year views have no budget field', async () => {
      await ownersHistory();
      for (const period of ['day', 'year']) {
        const response = await stats(`period=${period}`);
        expect(response.status).toBe(200);
        expect('budget' in (await json(response))).toBe(false);
      }
    });

    it("rejects unauthenticated; a stranger never sees another space's budget", async () => {
      await ownersHistory();

      expect((await app.request('/api/stats?period=month&anchor=2026-02-01')).status).toBe(401);

      const response = await stats('period=month&anchor=2026-02-01', STRANGER);
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.budget ?? null).toBeNull();
      expect(body.outCents).toBe(0);
    });

    it('the line compares the budget with budgeted spending, not the headline Spent', async () => {
      await ownersHistory();
      const categories = await json(await app.request('/api/categories', { headers: auth(OWNER) }));
      const transfers = categories.categories.find((c: { slug: string }) => c.slug === 'transfers');
      expect(transfers.excludeFromBudget).toBe(true);
      await expense(10_000, '2026-02-02', { categoryId: transfers.id });

      const body = await json(await stats('period=month&anchor=2026-02-01'));
      expect(body.outCents).toBe(41_000);
      expect(body.budget).toEqual({
        budgetCents: 35_000,
        spentCents: 31_000,
        status: 'under',
        differenceCents: 4_000,
        isCurrent: false,
      });
    });

    it('a cycle with no transactions shows no line; income alone still counts', async () => {
      await ownersHistory();
      await post(app, OWNER, OCT_31, {
        direction: 'in',
        amountCents: 5_000,
        occurredOn: '2024-03-10',
      });

      const empty = await json(await stats('period=month&anchor=2023-06-05'));
      expect(empty.count).toBe(0);
      expect(empty.budget ?? null).toBeNull();

      const incomeOnly = await json(await stats('period=month&anchor=2024-03-10'));
      expect(incomeOnly.budget).toEqual({
        budgetCents: 35_000,
        spentCents: 0,
        status: 'under',
        differenceCents: 35_000,
        isCurrent: false,
      });
    });

    it('the current cycle uses the live budget across timezones, a finished cycle uses the history', async () => {
      const { shared } = await sharedSpace('Europe/London');
      await householdsRepo.updateBudget(handle.db, shared.id, 50_000, BUDGET_HISTORY_EPOCH);
      const target = makeApp(NOV_1_0130_SG);
      await expense(2_000, '2026-10-10', {}, target, OWNER, NOV_1_0130_SG);
      await expense(2_000, '2026-09-10', {}, target, OWNER, NOV_1_0130_SG);

      // P (Singapore, already 1 Nov) sets 60 000, dated 2026-11-01.
      expect((await patchBudget(60_000, PARTNER, target, NOV_1_0130_SG)).status).toBe(200);
      expect(await changesOf(shared.id)).toContainEqual({
        effectiveFrom: '2026-11-01',
        budgetCents: 60_000,
      });

      // V (London, still 31 Oct): October is current -> the live budget.
      const october = await json(await stats('period=month', OWNER, target, NOV_1_0130_SG));
      expect(october.budget).toEqual({
        budgetCents: 60_000,
        spentCents: 2_000,
        status: 'under',
        differenceCents: 58_000,
        isCurrent: true,
      });
      const september = await json(
        await stats('period=month&anchor=2026-09-15', OWNER, target, NOV_1_0130_SG),
      );
      expect(september.budget).toEqual({
        budgetCents: 50_000,
        spentCents: 2_000,
        status: 'under',
        differenceCents: 48_000,
        isCurrent: false,
      });
    });
  });
});

describe('statsResponseSchema', () => {
  const base = {
    period: 'month',
    from: '2026-02-01',
    to: '2026-02-28',
    label: 'February 2026',
    inCents: 0,
    outCents: 0,
    netCents: 0,
    count: 0,
    byCategory: [],
    series: [],
    previousOutCents: 0,
  };
  const budget = {
    budgetCents: 35_000,
    spentCents: 31_000,
    status: 'under',
    differenceCents: 4_000,
    isCurrent: false,
  };

  it('parses with and without budget, rejects an unknown status or a missing isCurrent', () => {
    expect(statsResponseSchema.safeParse(base).success).toBe(true); // an old server
    expect(statsResponseSchema.safeParse({ ...base, budget: null }).success).toBe(true);
    expect(statsResponseSchema.safeParse({ ...base, budget }).success).toBe(true);
    expect(
      statsResponseSchema.safeParse({ ...base, budget: { ...budget, status: 'maybe' } }).success,
    ).toBe(false);
    const { isCurrent: _omitted, ...withoutIsCurrent } = budget;
    expect(statsResponseSchema.safeParse({ ...base, budget: withoutIsCurrent }).success).toBe(
      false,
    );
  });
});
