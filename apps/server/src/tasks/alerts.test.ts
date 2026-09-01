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
