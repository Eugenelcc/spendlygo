/**
 * Integration tests for budget threshold alerts.
 *
 * GUARDRAILS.md section 3: this is the idempotency-under-double-fire case
 * again — a threshold must be announced exactly once per month no matter how
 * many times the hourly tick re-checks it.
 */

import { eq } from 'drizzle-orm';
import { Bot } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '@spendlygo/core';
import {
  alertsRepo,
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
import { checkBudgetAlerts } from './alerts.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const TELEGRAM_ID = 950000000001n;
const TODAY = '2026-08-15';

describeIfDb('checkBudgetAlerts', () => {
  let handle: DatabaseHandle;
  let user: User;
  let sendMessage: ReturnType<typeof vi.fn>;
  let bot: Bot<BotContext>;

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

    sendMessage = vi.fn().mockResolvedValue(undefined);
    bot = new Bot<BotContext>('111111:token', { botInfo: undefined as never });
    bot.api.sendMessage = sendMessage;
  });

  afterAll(async () => {
    await cleanUp();
    await handle.close();
  });

  async function setBudget(cents: number): Promise<void> {
    await householdsRepo.updateBudget(handle.db, user.activeHouseholdId as string, cents);
  }

  it('does nothing for a user with no budget', async () => {
    const sent = await checkBudgetAlerts(ctx, bot);
    expect(sent).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not alert under 80% spent', async () => {
    await setBudget(100_000);
    await transactionsRepo.create(handle.db, {
      userId: user.id,
      householdId: user.activeHouseholdId as string,
      direction: 'out',
      amountCents: 70_000,
      categoryId: null,
      note: 'spend',
      occurredOn: TODAY,
      source: 'chat',
    });

    const sent = await checkBudgetAlerts(ctx, bot);
    expect(sent).toBe(0);
  });

  it('fires the 80% warning once spend crosses it', async () => {
    await setBudget(100_000);
    await transactionsRepo.create(handle.db, {
      userId: user.id,
      householdId: user.activeHouseholdId as string,
      direction: 'out',
      amountCents: 85_000,
      categoryId: null,
      note: 'spend',
      occurredOn: TODAY,
      source: 'chat',
    });

    const sent = await checkBudgetAlerts(ctx, bot);
    expect(sent).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = sendMessage.mock.calls[0] as [string, string];
    expect(text).toContain('80%');
  });

  it('fires both 80% and 100% in the same run when spend is already over', async () => {
    await setBudget(100_000);
    await transactionsRepo.create(handle.db, {
      userId: user.id,
      householdId: user.activeHouseholdId as string,
      direction: 'out',
      amountCents: 120_000,
      categoryId: null,
      note: 'spend',
      occurredOn: TODAY,
      source: 'chat',
    });

    const sent = await checkBudgetAlerts(ctx, bot);
    expect(sent).toBe(2);
  });

  it('GUARDRAILS section 3: never re-announces a threshold already sent this month', async () => {
    await setBudget(100_000);
    await transactionsRepo.create(handle.db, {
      userId: user.id,
      householdId: user.activeHouseholdId as string,
      direction: 'out',
      amountCents: 90_000,
      categoryId: null,
      note: 'spend',
      occurredOn: TODAY,
      source: 'chat',
    });

    const first = await checkBudgetAlerts(ctx, bot);
    const second = await checkBudgetAlerts(ctx, bot);

    expect(first).toBe(1);
    expect(second).toBe(0); // same tick condition, same month — already recorded
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not re-alert 80% once past it, only the next threshold', async () => {
    await setBudget(100_000);
    await transactionsRepo.create(handle.db, {
      userId: user.id,
      householdId: user.activeHouseholdId as string,
      direction: 'out',
      amountCents: 85_000,
      categoryId: null,
      note: 'first spend',
      occurredOn: TODAY,
      source: 'chat',
    });
    await checkBudgetAlerts(ctx, bot); // fires 80%

    await transactionsRepo.create(handle.db, {
      userId: user.id,
      householdId: user.activeHouseholdId as string,
      direction: 'out',
      amountCents: 20_000,
      categoryId: null,
      note: 'pushes over 100%',
      occurredOn: TODAY,
      source: 'chat',
    });
    const sent = await checkBudgetAlerts(ctx, bot); // only 100% should be new

    expect(sent).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const [, secondText] = sendMessage.mock.calls[1] as [string, string];
    expect(secondText).toContain('Budget spent');
  });

  it('does nothing when alerts are switched off', async () => {
    await setBudget(100_000);
    await usersRepo.updateSettings(handle.db, user.id, { alertsEnabled: false });
    await transactionsRepo.create(handle.db, {
      userId: user.id,
      householdId: user.activeHouseholdId as string,
      direction: 'out',
      amountCents: 120_000,
      categoryId: null,
      note: 'spend',
      occurredOn: TODAY,
      source: 'chat',
    });

    const sent = await checkBudgetAlerts(ctx, bot);
    expect(sent).toBe(0);
  });

  it('recordIfNew returns an id on the first reservation, null on a repeat', async () => {
    const first = await alertsRepo.recordIfNew(handle.db, user.id, 2026, 8, 80);
    const second = await alertsRepo.recordIfNew(handle.db, user.id, 2026, 8, 80);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('release lets a later reservation take the same threshold again', async () => {
    const first = await alertsRepo.recordIfNew(handle.db, user.id, 2026, 8, 80);
    expect(first).not.toBeNull();

    await alertsRepo.release(handle.db, first as string);

    const second = await alertsRepo.recordIfNew(handle.db, user.id, 2026, 8, 80);
    expect(second).not.toBeNull();
  });

  it('a delivery failure does not permanently suppress the threshold — the bug this test caught live', async () => {
    // The exact sequence that surfaced this: recordIfNew succeeds, then
    // sendMessage throws. Without releasing the reservation, this threshold
    // would never be retried and the user would never be told.
    await setBudget(100_000);
    await transactionsRepo.create(handle.db, {
      userId: user.id,
      householdId: user.activeHouseholdId as string,
      direction: 'out',
      amountCents: 85_000,
      categoryId: null,
      note: 'spend',
      occurredOn: TODAY,
      source: 'chat',
    });

    sendMessage.mockRejectedValueOnce(new Error('Network request for sendMessage failed'));

    const failedRun = await checkBudgetAlerts(ctx, bot);
    expect(failedRun).toBe(0); // the send failed, so nothing was actually delivered

    const stored = await alertsRepo.sentThisMonth(handle.db, user.id, 2026, 8);
    expect(stored.has(80)).toBe(false); // the reservation must have been released

    // The next tick, with a working send, must actually deliver it.
    const retryRun = await checkBudgetAlerts(ctx, bot);
    expect(retryRun).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(2); // 1 failed attempt + 1 successful retry
  });
});

// -----------------------------------------------------------------------------
// F17 pay cycle (B-032 Part 2, P2-AC14 to AC21). Written before the feature
// exists. Alerts are remembered by the calendar month the cycle ENDS in
// (owner decision Q2 A): no migration, and a threshold is never sent twice for
// one key. The honest limitation is pinned by the P2-AC20 test below.
// -----------------------------------------------------------------------------

const CYCLE_TELEGRAM_ID = 950000000002n;
const BUDGET = 100_000; // S$1,000

describeIfDb('pay cycle (F17)', () => {
  let handle: DatabaseHandle;
  let user: User;
  let sendMessage: ReturnType<typeof vi.fn>;
  let bot: Bot<BotContext>;

  const baseCtx: AppContext = {
    config: {} as AppContext['config'],
    db: null as never,
    dbHandle: null as never,
    clock: fixedClock('2026-10-31T04:00:00Z'),
  };

  /** A context pinned to noon in Singapore on `date`. */
  const ctxOn = (date: string): AppContext => ({
    ...baseCtx,
    clock: fixedClock(`${date}T04:00:00Z`),
  });

  beforeAll(async () => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    Object.assign(baseCtx, { db: handle.db, dbHandle: handle });
  });

  async function cleanUp(): Promise<void> {
    const rows = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.telegramId, CYCLE_TELEGRAM_ID));
    for (const row of rows) {
      await handle.db.delete(schema.transactions).where(eq(schema.transactions.userId, row.id));
      await handle.db.delete(schema.households).where(eq(schema.households.createdBy, row.id));
    }
    await handle.db.delete(schema.users).where(eq(schema.users.telegramId, CYCLE_TELEGRAM_ID));
  }

  beforeEach(async () => {
    await cleanUp();
    user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: CYCLE_TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
    sendMessage = vi.fn().mockResolvedValue(undefined);
    bot = new Bot<BotContext>('111111:token', { botInfo: undefined as never });
    bot.api.sendMessage = sendMessage;
    await householdsRepo.updateBudget(handle.db, user.activeHouseholdId as string, BUDGET);
  });

  afterAll(async () => {
    await cleanUp();
    await handle.close();
  });

  async function setStartDay(day: number): Promise<void> {
    await householdsRepo.updateCycleStartDay(handle.db, user.activeHouseholdId as string, day);
  }

  async function spend(cents: number, occurredOn: string): Promise<void> {
    await transactionsRepo.create(handle.db, {
      userId: user.id,
      householdId: user.activeHouseholdId as string,
      direction: 'out',
      amountCents: cents,
      categoryId: null,
      note: null,
      occurredOn,
      source: 'chat',
    });
  }

  /** Texts sent to this test's user only (other test files may leave users behind). */
  function mine(): string[] {
    return (sendMessage.mock.calls as Array<[string, string]>)
      .filter(([chatId]) => chatId === CYCLE_TELEGRAM_ID.toString())
      .map(([, text]) => text);
  }

  it('spend before the cycle start does not count', async () => {
    // P2-AC14: S$900 on 5 Oct is in the previous cycle; this cycle is 50%.
    await setStartDay(20);
    await spend(90_000, '2026-10-05');
    await spend(50_000, '2026-10-25');

    await checkBudgetAlerts(ctxOn('2026-10-31'), bot);
    expect(mine()).toHaveLength(0);
  });

  it('a double-fired tick sends the 80% alert once per cycle', async () => {
    // P2-AC15: 85% of the 20 Oct - 19 Nov cycle.
    await setStartDay(20);
    await spend(90_000, '2026-10-05');
    await spend(50_000, '2026-10-25');
    await spend(35_000, '2026-10-31');

    await checkBudgetAlerts(ctxOn('2026-10-31'), bot);
    await checkBudgetAlerts(ctxOn('2026-10-31'), bot);

    expect(mine()).toHaveLength(1);
    expect(mine()[0]).toContain('80%');
  });

  it('thresholds re-arm in the next cycle', async () => {
    // P2-AC16
    await setStartDay(20);
    await spend(90_000, '2026-10-05');
    await spend(50_000, '2026-10-25');
    await spend(35_000, '2026-10-31');
    await checkBudgetAlerts(ctxOn('2026-10-31'), bot);
    expect(mine()).toHaveLength(1); // the 80% alert for 20 Oct - 19 Nov (key November)

    // The next cycle, 20 Nov - 19 Dec, starts with S$850 spent.
    await spend(85_000, '2026-11-20');
    await checkBudgetAlerts(ctxOn('2026-11-20'), bot);

    expect(mine()).toHaveLength(2);
    expect(mine()[1]).toContain('80%');
    expect((await alertsRepo.sentThisMonth(handle.db, user.id, 2026, 11)).has(80)).toBe(true);
    expect((await alertsRepo.sentThisMonth(handle.db, user.id, 2026, 12)).has(80)).toBe(true);
  });

  it('the 100% text names the cycle range', async () => {
    // P2-AC17: day 20 names the range; day 1 still names "2026-10".
    await setStartDay(20);
    await spend(120_000, '2026-10-25');

    await checkBudgetAlerts(ctxOn('2026-10-31'), bot);
    const day20Over = mine().find((text) => text.includes('Budget spent'));
    expect(day20Over).toContain('over for 20 Oct – 19 Nov');

    await setStartDay(1); // key October: not used yet by the day-20 alerts (key November)
    await checkBudgetAlerts(ctxOn('2026-10-31'), bot);
    const day1Over = mine()
      .filter((text) => text.includes('Budget spent'))
      .at(-1);
    expect(day1Over).toContain('over for 2026-10');
    expect(day1Over).not.toContain('20 Oct');
  });

  it('a day-1 row written before B-032 still suppresses the repeat', async () => {
    // P2-AC18 (regression guard): old rows are keyed (user, 2026, 10, 80).
    await spend(85_000, '2026-10-31');
    await alertsRepo.recordIfNew(handle.db, user.id, 2026, 10, 80);

    await checkBudgetAlerts(ctxOn('2026-10-31'), bot);
    expect(mine()).toHaveLength(0);
  });

  it('switching 1 → 20 after an October alert still alerts in the new cycle', async () => {
    // P2-AC19: day 1 alerted for October (key October); day 20 ends in November.
    await spend(85_000, '2026-10-25');
    await checkBudgetAlerts(ctxOn('2026-10-31'), bot);
    expect(mine()).toHaveLength(1);

    await setStartDay(20);
    await checkBudgetAlerts(ctxOn('2026-10-31'), bot);

    expect(mine()).toHaveLength(2);
    expect(mine()[1]).toContain('80%');
    expect((await alertsRepo.sentThisMonth(handle.db, user.id, 2026, 11)).has(80)).toBe(true);
  });

  it("documented limitation: switching 20 → 1 on 25 Oct skips October's 80% alert once", async () => {
    // P2-AC20 (Q2 A, accepted by the owner). The 80% alert for 20 Sep - 19 Oct
    // went out on 15 Oct under key (2026, 10). Moving to day 1 on 25 Oct makes
    // the cycle 1-31 Oct, which shares that key, so its 80% alert is skipped.
    // It is a suppressed alert, never a duplicate.
    await setStartDay(20);
    await spend(85_000, '2026-10-15');
    await checkBudgetAlerts(ctxOn('2026-10-15'), bot);
    expect(mine()).toHaveLength(1);
    expect((await alertsRepo.sentThisMonth(handle.db, user.id, 2026, 10)).has(80)).toBe(true);

    await setStartDay(1);
    await checkBudgetAlerts(ctxOn('2026-10-25'), bot);
    expect(mine()).toHaveLength(1); // no second 80% message
  });

  it('flipping through every start day on one date never sends a threshold twice', async () => {
    // P2-AC21: S$850 on 31 Oct is >= 80% and < 100% of every cycle containing
    // that day. Cycles containing 31 Oct end in November (start day 2-31, 20)
    // or October (start day 1), so exactly two keys exist.
    await spend(85_000, '2026-10-31');
    const days = [20, 1, ...Array.from({ length: 30 }, (_, index) => index + 2), 20];
    expect(days).toHaveLength(33);

    for (const day of days) {
      await setStartDay(day);
      await checkBudgetAlerts(ctxOn('2026-10-31'), bot);
    }

    const texts = mine();
    expect(texts.filter((text) => text.includes('80%'))).toHaveLength(2);
    expect(texts.filter((text) => text.includes('Budget spent'))).toHaveLength(0);
    expect(texts).toHaveLength(2);
  });
});
