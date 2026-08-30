/**
 * Integration tests for recurring materialisation.
 *
 * GUARDRAILS.md section 3: the cron WILL double-fire, and this is the code
 * that must make that harmless. Runs against a real database because the
 * idempotency guarantee lives in a unique index and a transaction, neither of
 * which an in-memory fake would exercise honestly.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '@spendlygo/core';
import {
  createDatabase,
  recurringRepo,
  schema,
  transactionsRepo,
  usersRepo,
  type DatabaseHandle,
} from '@spendlygo/db';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';
import { materialiseRecurring } from './recurring.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const TELEGRAM_ID = 920000000001n;

describeIfDb('materialiseRecurring', () => {
  let handle: DatabaseHandle;
  let userId: string;

  const ctxAt = (isoInstant: string): AppContext => ({
    config: {} as AppContext['config'],
    db: handle.db,
    dbHandle: handle,
    clock: fixedClock(isoInstant),
  });

  beforeAll(async () => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
  });

  beforeEach(async () => {
    await handle.db.delete(schema.users).where(eq(schema.users.telegramId, TELEGRAM_ID));
    const user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
    userId = user.id;
  });

  afterAll(async () => {
    await handle.db.delete(schema.users).where(eq(schema.users.telegramId, TELEGRAM_ID));
    await handle.close();
  });

  it('materialises a due monthly rule exactly once', async () => {
    await recurringRepo.create(handle.db, {
      userId,
      direction: 'out',
      amountCents: 150_000,
      categoryId: null,
      note: 'rent',
      cadence: 'monthly',
      anchorDate: '2026-08-01',
      dayOfMonth: 1,
      endDate: null,
    });

    // NOW is 2026-08-01 04:00Z = noon in Singapore.
    const count = await materialiseRecurring(ctxAt('2026-08-01T04:00:00Z'));
    expect(count).toBe(1);

    const rows = await transactionsRepo.list(handle.db, userId, { limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountCents).toBe(150_000);
    expect(rows[0]?.source).toBe('recurring');
  });

  it('GUARDRAILS section 3: a double-fired tick never double-charges', async () => {
    await recurringRepo.create(handle.db, {
      userId,
      direction: 'out',
      amountCents: 150_000,
      categoryId: null,
      note: 'rent',
      cadence: 'monthly',
      anchorDate: '2026-08-01',
      dayOfMonth: 1,
      endDate: null,
    });

    const ctx = ctxAt('2026-08-01T04:00:00Z');
    const first = await materialiseRecurring(ctx);
    const second = await materialiseRecurring(ctx);

    expect(first).toBe(1);
    expect(second).toBe(0); // the watermark already covers this occurrence

    const rows = await transactionsRepo.list(handle.db, userId, { limit: 10 });
    expect(rows).toHaveLength(1);
  });

  it('PRD F5.4: backfills every occurrence missed while the service was down', async () => {
    await recurringRepo.create(handle.db, {
      userId,
      direction: 'out',
      amountCents: 500,
      categoryId: null,
      note: 'daily coffee subscription',
      cadence: 'daily',
      anchorDate: '2026-08-01',
      dayOfMonth: null,
      endDate: null,
    });

    // First tick after the rule was created: only day 1 is due.
    await materialiseRecurring(ctxAt('2026-08-01T04:00:00Z'));
    // The service then sat idle for 4 days; the next tick lands on the 5th.
    const count = await materialiseRecurring(ctxAt('2026-08-05T04:00:00Z'));

    expect(count).toBe(4); // the 2nd, 3rd, 4th and 5th — none skipped

    const rows = await transactionsRepo.list(handle.db, userId, { limit: 10 });
    expect(rows).toHaveLength(5);
  });

  it('PRD F5.2: clamps a month-end rule instead of skipping February', async () => {
    await recurringRepo.create(handle.db, {
      userId,
      direction: 'out',
      amountCents: 1000,
      categoryId: null,
      note: 'rent',
      cadence: 'monthly',
      anchorDate: '2026-01-31',
      dayOfMonth: 31,
      endDate: null,
    });

    await materialiseRecurring(ctxAt('2026-01-31T04:00:00Z'));
    await materialiseRecurring(ctxAt('2026-02-28T04:00:00Z'));

    const rows = await transactionsRepo.list(handle.db, userId, { limit: 10 });
    const dates = rows.map((row) => row.occurredOn).sort();
    expect(dates).toEqual(['2026-01-31', '2026-02-28']);
  });

  it('does nothing before a rule is due', async () => {
    await recurringRepo.create(handle.db, {
      userId,
      direction: 'out',
      amountCents: 1000,
      categoryId: null,
      note: 'future rule',
      cadence: 'monthly',
      anchorDate: '2026-12-01',
      dayOfMonth: 1,
      endDate: null,
    });

    const count = await materialiseRecurring(ctxAt('2026-08-01T04:00:00Z'));
    expect(count).toBe(0);
  });

  it('leaves a deactivated rule alone', async () => {
    const rule = await recurringRepo.create(handle.db, {
      userId,
      direction: 'out',
      amountCents: 1000,
      categoryId: null,
      note: 'cancelled',
      cadence: 'daily',
      anchorDate: '2026-08-01',
      dayOfMonth: null,
      endDate: null,
    });
    await recurringRepo.deactivate(handle.db, userId, rule.id);

    const count = await materialiseRecurring(ctxAt('2026-08-05T04:00:00Z'));
    expect(count).toBe(0);
  });
});
