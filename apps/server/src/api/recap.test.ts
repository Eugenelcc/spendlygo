/**
 * Integration tests for computeStreak and buildRecap — both read real rows
 * back out of Postgres, which is what actually proves the SQL and the
 * timezone-correct date math agree with each other.
 */

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
import { buildRecap } from './recap.js';
import { computeStreak } from './service.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const TELEGRAM_ID = 940000000001n;
const TODAY = '2026-08-27' as IsoDate;

async function logOn(db: DatabaseHandle['db'], userId: string, occurredOn: string) {
  await transactionsRepo.create(db, {
    userId,
    householdId: null,
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

  describe('computeStreak', () => {
    it('is zero with no history', async () => {
      const streak = await computeStreak(ctx, user, TODAY);
      expect(streak).toEqual({ current: 0, longest: 0 });
    });

    it('counts real consecutive rows from the database', async () => {
      await logOn(handle.db, user.id, '2026-08-25');
      await logOn(handle.db, user.id, '2026-08-26');
      await logOn(handle.db, user.id, '2026-08-27');

      const streak = await computeStreak(ctx, user, TODAY);
      expect(streak.current).toBe(3);
      expect(streak.longest).toBe(3);
    });

    it('collapses two entries on the same day to one streak day, not two', async () => {
      await logOn(handle.db, user.id, TODAY);
      await logOn(handle.db, user.id, TODAY);

      const streak = await computeStreak(ctx, user, TODAY);
      expect(streak.current).toBe(1);
    });

    it('ignores a soft-deleted entry — deleting your only entry for a day breaks the streak', async () => {
      const created = await transactionsRepo.create(handle.db, {
        userId: user.id,
        householdId: null,
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
      await logOn(handle.db, user.id, '2026-08-26');
      await logOn(handle.db, user.id, TODAY);

      const recap = await buildRecap(ctx, user, 'month', TODAY, TODAY);
      expect(recap.label).toBe('August 2026');
      expect(recap.stats.totals.outCents).toBe(1000);
      expect(recap.streak.current).toBe(2);
    });

    it('never reads past `today`, even for a year period ending in the future', async () => {
      await logOn(handle.db, user.id, TODAY);

      const recap = await buildRecap(ctx, user, 'year', TODAY, TODAY);
      // The year technically runs to 31 Dec — the recap must not claim a
      // "today" past the real one, or safe-to-spend would be nonsensical.
      expect(recap.to).toBe(TODAY);
    });

    it('a year recap and a month recap agree on total spend for August alone', async () => {
      await logOn(handle.db, user.id, TODAY);
      const monthRecap = await buildRecap(ctx, user, 'month', TODAY, TODAY);
      const yearRecap = await buildRecap(ctx, user, 'year', TODAY, TODAY);
      expect(yearRecap.stats.totals.outCents).toBe(monthRecap.stats.totals.outCents);
    });
  });
});
