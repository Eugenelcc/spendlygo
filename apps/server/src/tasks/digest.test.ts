import { eq } from 'drizzle-orm';
import { Bot } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGET_HISTORY_EPOCH, fixedClock, type IsoDate } from '@spendlygo/core';
import {
  createDatabase,
  householdsRepo,
  schema,
  transactionsRepo,
  usersRepo,
  type DatabaseHandle,
  type User,
} from '@spendlygo/db';
import type { BotContext } from '../bot/middleware.js';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';
import { buildDigest, buildMonthlyDigest, buildWeeklyDigest } from './digest.js';
import { sendDueDigests } from './send-digests.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const TELEGRAM_ID = 930000000001n;
const TODAY = '2026-08-27' as IsoDate; // a Thursday, inside the week of Mon 24 - Sun 30 Aug

describeIfDb('the digest family', () => {
  let handle: DatabaseHandle;
  let user: User;

  const ctx: AppContext = {
    config: {} as AppContext['config'],
    db: null as never,
    dbHandle: null as never,
    clock: fixedClock(`${TODAY}T04:00:00Z`),
  };

  beforeAll(async () => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    Object.assign(ctx, { db: handle.db, dbHandle: handle });
  });

  async function cleanUp(): Promise<void> {
    const rows = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.telegramId, TELEGRAM_ID));
    for (const row of rows) {
      await handle.db.delete(schema.transactions).where(eq(schema.transactions.userId, row.id));
      await handle.db.delete(schema.households).where(eq(schema.households.createdBy, row.id));
    }
    await handle.db.delete(schema.users).where(eq(schema.users.telegramId, TELEGRAM_ID));
  }

  beforeEach(async () => {
    await cleanUp();
    user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
  });

  afterAll(async () => {
    await cleanUp();
    await handle.close();
  });

  async function setBudget(cents: number): Promise<void> {
    await householdsRepo.updateBudget(
      handle.db,
      user.activeHouseholdId as string,
      cents,
      BUDGET_HISTORY_EPOCH,
    );
  }

  describe('buildDigest (daily)', () => {
    it('is not worth sending once budget, nudge and automatic entries are all absent', async () => {
      await usersRepo.updateSettings(handle.db, user.id, { nudgeEnabled: false });
      const refreshed = (await usersRepo.findById(handle.db, user.id)) as User;

      const digest = await buildDigest(ctx, refreshed, TODAY);
      expect(digest.worthSending).toBe(false);
    });

    it('nudges an unbudgeted user who has logged nothing, when nudges are on', async () => {
      await usersRepo.updateSettings(handle.db, user.id, { nudgeEnabled: true });
      const refreshed = (await usersRepo.findById(handle.db, user.id)) as User;

      const digest = await buildDigest(ctx, refreshed, TODAY);
      expect(digest.worthSending).toBe(true);
      expect(digest.text).toContain("haven't logged");
    });

    it('stays quiet when the nudge is switched off', async () => {
      await usersRepo.updateSettings(handle.db, user.id, { nudgeEnabled: false });
      const refreshed = (await usersRepo.findById(handle.db, user.id)) as User;

      const digest = await buildDigest(ctx, refreshed, TODAY);
      expect(digest.worthSending).toBe(false);
      expect(digest.text).not.toContain("haven't logged");
    });

    it('does not nudge someone who already logged something today', async () => {
      await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: user.activeHouseholdId as string,
        direction: 'out',
        amountCents: 500,
        categoryId: null,
        note: 'coffee',
        occurredOn: TODAY,
        source: 'chat',
      });

      const digest = await buildDigest(ctx, user, TODAY);
      expect(digest.text).not.toContain("haven't logged");
    });

    it('reports pace and tomorrow once a budget is set', async () => {
      await setBudget(150_000);
      const refreshed = (await usersRepo.findById(handle.db, user.id)) as User;

      const digest = await buildDigest(ctx, refreshed, TODAY);
      expect(digest.worthSending).toBe(true);
      expect(digest.text).toContain('safe to spend tomorrow');
    });

    it('warns rather than hides when tomorrow starts over budget', async () => {
      await setBudget(100);
      await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: user.activeHouseholdId as string,
        direction: 'out',
        amountCents: 100_000,
        categoryId: null,
        note: 'big purchase',
        occurredOn: TODAY,
        source: 'chat',
      });
      const refreshed = (await usersRepo.findById(handle.db, user.id)) as User;

      const digest = await buildDigest(ctx, refreshed, TODAY);
      expect(digest.text).toContain('over budget');
    });
  });

  describe('buildWeeklyDigest', () => {
    const SUNDAY = '2026-08-30' as IsoDate;

    it('is not worth sending for an empty week with no budget', async () => {
      const digest = await buildWeeklyDigest(ctx, user, SUNDAY);
      expect(digest.worthSending).toBe(false);
    });

    it('summarises the Monday-through-Sunday week just finished', async () => {
      // Inside the week (Mon 24 Aug - Sun 30 Aug).
      await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: user.activeHouseholdId as string,
        direction: 'out',
        amountCents: 4200,
        categoryId: null,
        note: 'groceries',
        occurredOn: '2026-08-26',
        source: 'chat',
      });
      // Outside the week — must not be counted.
      await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: user.activeHouseholdId as string,
        direction: 'out',
        amountCents: 99999,
        categoryId: null,
        note: 'should not appear',
        occurredOn: '2026-08-17',
        source: 'chat',
      });

      const digest = await buildWeeklyDigest(ctx, user, SUNDAY);
      expect(digest.worthSending).toBe(true);
      expect(digest.text).toContain('42.00');
      expect(digest.text).not.toContain('999.99');
    });

    it('compares against the seven days before, not the whole month', async () => {
      // Previous week (Mon 17 - Sun 23 Aug).
      await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: user.activeHouseholdId as string,
        direction: 'out',
        amountCents: 10000,
        categoryId: null,
        note: 'last week',
        occurredOn: '2026-08-20',
        source: 'chat',
      });
      // This week.
      await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: user.activeHouseholdId as string,
        direction: 'out',
        amountCents: 5000,
        categoryId: null,
        note: 'this week',
        occurredOn: '2026-08-26',
        source: 'chat',
      });

      const digest = await buildWeeklyDigest(ctx, user, SUNDAY);
      expect(digest.text).toContain('50%');
      expect(digest.text).toContain('less');
    });
  });

  describe('buildMonthlyDigest', () => {
    const MONTH_END = '2026-08-31' as IsoDate;

    it('is not worth sending for an empty month with no budget', async () => {
      const digest = await buildMonthlyDigest(ctx, user, MONTH_END);
      expect(digest.worthSending).toBe(false);
    });

    it("names the month and totals what's inside it", async () => {
      await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: user.activeHouseholdId as string,
        direction: 'out',
        amountCents: 15000,
        categoryId: null,
        note: 'rent',
        occurredOn: '2026-08-01',
        source: 'chat',
      });
      // Spills into July — must not count toward August's total.
      await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: user.activeHouseholdId as string,
        direction: 'out',
        amountCents: 88888,
        categoryId: null,
        note: 'july spend',
        occurredOn: '2026-07-31',
        source: 'chat',
      });

      const digest = await buildMonthlyDigest(ctx, user, MONTH_END);
      expect(digest.text).toContain('August');
      expect(digest.text).toContain('150.00');
      expect(digest.text).not.toContain('888.88');
    });

    // F17 (B-032 Part 2, P2-AC12): start day 20, today = the cycle's last day.
    it('names the cycle range and totals only the cycle', async () => {
      const spaceId = user.activeHouseholdId as string;
      await householdsRepo.updateCycleStartDay(handle.db, spaceId, 20);
      for (const [cents, occurredOn] of [
        [10_000, '2026-10-05'], // previous cycle: 20 Sep - 19 Oct
        [5_000, '2026-10-25'], // this cycle: 20 Oct - 19 Nov
      ] as const) {
        await transactionsRepo.create(handle.db, {
          userId: user.id,
          householdId: spaceId,
          direction: 'out',
          amountCents: cents,
          categoryId: null,
          note: null,
          occurredOn,
          source: 'chat',
        });
      }

      const digest = await buildMonthlyDigest(ctx, user, '2026-11-19' as IsoDate);
      expect(digest.worthSending).toBe(true);
      expect(digest.text).toContain('*20 Oct – 19 Nov*');
      expect(digest.text).toContain('$50.00');
      expect(digest.text).not.toContain('$150.00');
      expect(digest.text).toContain('50% less'); // compared with 20 Sep - 19 Oct (S$100)
    });
  });

  // F17 (B-032 Part 2, P2-AC13)
  describe('sendDueDigests', () => {
    async function runAt(instant: string): Promise<string[]> {
      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const bot = new Bot<BotContext>('111111:token', { botInfo: undefined as never });
      bot.api.sendMessage = sendMessage;
      await sendDueDigests({ ...ctx, clock: fixedClock(instant) }, bot);
      // Other test files may leave eligible users behind: only count ours.
      return (sendMessage.mock.calls as Array<[string, string]>)
        .filter(([chatId]) => chatId === TELEGRAM_ID.toString())
        .map(([, text]) => text);
    }

    it("sends the monthly digest on the cycle's last day, not the calendar month end", async () => {
      const spaceId = user.activeHouseholdId as string;
      await householdsRepo.updateBudget(handle.db, spaceId, 150_000, BUDGET_HISTORY_EPOCH);
      await householdsRepo.updateCycleStartDay(handle.db, spaceId, 20);

      // 21:00 in Singapore on 31 Oct: the calendar month ends, the cycle doesn't.
      const oct31 = await runAt('2026-10-31T13:00:00Z');
      expect(oct31).toHaveLength(1); // daily only
      expect(oct31.some((text) => text.includes('*20 Oct – 19 Nov*'))).toBe(false);

      // 21:00 on 19 Nov: the cycle's last day.
      const nov19 = await runAt('2026-11-19T13:00:00Z');
      expect(nov19).toHaveLength(2); // daily and monthly
      expect(nov19.some((text) => text.includes('*20 Oct – 19 Nov*'))).toBe(true);
    });
  });
});
