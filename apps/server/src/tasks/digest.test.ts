import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock, type IsoDate } from '@spendlygo/core';
import {
  createDatabase,
  schema,
  transactionsRepo,
  usersRepo,
  type DatabaseHandle,
  type User,
} from '@spendlygo/db';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';
import { buildDigest, buildMonthlyDigest, buildWeeklyDigest } from './digest.js';

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

  beforeEach(async () => {
    await handle.db.delete(schema.users).where(eq(schema.users.telegramId, TELEGRAM_ID));
    user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
  });

  afterAll(async () => {
    await handle.db.delete(schema.users).where(eq(schema.users.telegramId, TELEGRAM_ID));
    await handle.close();
  });

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
        householdId: null,
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
      await usersRepo.updateSettings(handle.db, user.id, { monthlyBudgetCents: 150_000 });
      const refreshed = (await usersRepo.findById(handle.db, user.id)) as User;

      const digest = await buildDigest(ctx, refreshed, TODAY);
      expect(digest.worthSending).toBe(true);
      expect(digest.text).toContain('safe to spend tomorrow');
    });

    it('warns rather than hides when tomorrow starts over budget', async () => {
      await usersRepo.updateSettings(handle.db, user.id, { monthlyBudgetCents: 100 });
      await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: null,
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
        householdId: null,
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
        householdId: null,
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
        householdId: null,
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
        householdId: null,
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
        householdId: null,
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
        householdId: null,
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
  });
});
