/**
 * Integration tests for computeStreak and buildRecap — both read real rows
 * back out of Postgres, which is what actually proves the SQL and the
 * timezone-correct date math agree with each other.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';
import { buildRecap } from './recap.js';
import { computeStreak } from './service.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const TELEGRAM_ID = 940000000001n;
const TODAY = '2026-08-27' as IsoDate;

async function logOn(
  db: DatabaseHandle['db'],
  userId: string,
  householdId: string,
  occurredOn: string,
) {
  await transactionsRepo.create(db, {
    userId,
    householdId,
    direction: 'out',
    amountCents: 500,
    categoryId: null,
    note: null,
    occurredOn,
    source: 'chat',
  });
}

describeIfDb('computeStreak and buildRecap', () => {
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

  describe('computeStreak', () => {
    it('is zero with no history', async () => {
      const streak = await computeStreak(ctx, user, TODAY);
      expect(streak).toEqual({ current: 0, longest: 0 });
    });

    it('counts real consecutive rows from the database', async () => {
      await logOn(handle.db, user.id, user.activeHouseholdId as string, '2026-08-25');
      await logOn(handle.db, user.id, user.activeHouseholdId as string, '2026-08-26');
      await logOn(handle.db, user.id, user.activeHouseholdId as string, '2026-08-27');

      const streak = await computeStreak(ctx, user, TODAY);
      expect(streak.current).toBe(3);
      expect(streak.longest).toBe(3);
    });

    it('collapses two entries on the same day to one streak day, not two', async () => {
      await logOn(handle.db, user.id, user.activeHouseholdId as string, TODAY);
      await logOn(handle.db, user.id, user.activeHouseholdId as string, TODAY);

      const streak = await computeStreak(ctx, user, TODAY);
      expect(streak.current).toBe(1);
    });

    it('ignores a soft-deleted entry — deleting your only entry for a day breaks the streak', async () => {
      const created = await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: user.activeHouseholdId as string,
        direction: 'out',
        amountCents: 500,
        categoryId: null,
        note: null,
        occurredOn: TODAY,
        source: 'chat',
      });
      await transactionsRepo.softDelete(handle.db, user.id, created.id);

      const streak = await computeStreak(ctx, user, TODAY);
      expect(streak.current).toBe(0);
    });
  });

  describe('buildRecap', () => {
    it('reports nothing logged for an empty period without erroring', async () => {
      const recap = await buildRecap(ctx, user, 'month', TODAY, TODAY);
      expect(recap.stats.totals.count).toBe(0);
      expect(recap.stats.bestDay).toBeNull();
    });

    it('summarises real spend, the top category, and the streak together', async () => {
      await logOn(handle.db, user.id, user.activeHouseholdId as string, '2026-08-26');
      await logOn(handle.db, user.id, user.activeHouseholdId as string, TODAY);

      const recap = await buildRecap(ctx, user, 'month', TODAY, TODAY);
      expect(recap.label).toBe('August 2026');
      expect(recap.stats.totals.outCents).toBe(1000);
      expect(recap.streak.current).toBe(2);
    });

    it('never reads past `today`, even for a year period ending in the future', async () => {
      await logOn(handle.db, user.id, user.activeHouseholdId as string, TODAY);

      const recap = await buildRecap(ctx, user, 'year', TODAY, TODAY);
      // The year technically runs to 31 Dec — the recap must not claim a
      // "today" past the real one, or safe-to-spend would be nonsensical.
      expect(recap.to).toBe(TODAY);
    });

    it('a year recap and a month recap agree on total spend for August alone', async () => {
      await logOn(handle.db, user.id, user.activeHouseholdId as string, TODAY);
      const monthRecap = await buildRecap(ctx, user, 'month', TODAY, TODAY);
      const yearRecap = await buildRecap(ctx, user, 'year', TODAY, TODAY);
      expect(yearRecap.stats.totals.outCents).toBe(monthRecap.stats.totals.outCents);
    });
  });

  // F17 (B-032 Part 2, P2-AC6 and AC7). "Owner's October": budget S$1,500,
  // start day 20, S$100 on 2026-10-05 and S$50 on 2026-10-25, today 2026-10-31.
  describe('buildRecap with a pay cycle (F17)', () => {
    const OCT_31 = '2026-10-31' as IsoDate;

    async function ownersOctoberAtDay20(): Promise<void> {
      const spaceId = user.activeHouseholdId as string;
      await householdsRepo.updateBudget(handle.db, spaceId, 150_000, BUDGET_HISTORY_EPOCH);
      await householdsRepo.updateCycleStartDay(handle.db, spaceId, 20);
      for (const [cents, occurredOn] of [
        [10_000, '2026-10-05'],
        [5_000, '2026-10-25'],
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
    }

    it('a month recap follows the cycle and stops at today', async () => {
      await ownersOctoberAtDay20();
      const recap = await buildRecap(ctx, user, 'month', OCT_31, OCT_31);
      expect(recap.from).toBe('2026-10-20');
      expect(recap.to).toBe('2026-10-31'); // never past today
      expect(recap.label).toBe('20 Oct – 19 Nov');
      expect(recap.stats.totals.outCents).toBe(5000);
      expect(recap.stats.previousOutCents).toBe(10_000); // 20 Sep - 19 Oct
    });

    it('a year recap stays the calendar year with a day-20 cycle', async () => {
      await ownersOctoberAtDay20();
      const recap = await buildRecap(ctx, user, 'year', OCT_31, OCT_31);
      expect(recap.from).toBe('2026-01-01');
      expect(recap.to).toBe('2026-10-31');
      expect(recap.label).toBe('2026');
      expect(recap.stats.totals.outCents).toBe(15_000);
    });
  });
});
