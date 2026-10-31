/**
 * Tests for the /export command (B-032 Part 3, F17, P3-AC13 to AC15).
 * Written before the feature exists: `exportUsageText` and the new
 * `parseExportRange` signature are not built yet.
 */

import { eq } from 'drizzle-orm';
import { InputFile } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cycleContaining, fixedClock, type IsoDate } from '@spendlygo/core';
import {
  createDatabase,
  householdsRepo,
  schema,
  transactionsRepo,
  usersRepo,
  type DatabaseHandle,
  type User,
} from '@spendlygo/db';
import type { Config } from '../../config.js';
import type { AppContext } from '../../context.js';
import { setLogLevel } from '../../logger.js';
import type { BotContext } from '../middleware.js';
import { exportUsageText, handleExport } from './export.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const TELEGRAM_A = 980000000111n;
const OCT_31 = '2026-10-31T04:00:00Z'; // noon in Singapore

const config: Config = {
  nodeEnv: 'test',
  isProduction: false,
  port: 0,
  botToken: '111111:token',
  webhookSecretToken: 'secret-secret-secret',
  databaseUrl: TEST_DATABASE_URL ?? 'postgresql://localhost/db',
  miniappUrl: 'https://spendlygo-app.onrender.com',
  serverUrl: undefined,
  cronSecret: 'cron-cron-cron-cron',
  ocrSpaceApiKey: undefined,
  allowedTelegramIds: new Set<bigint>(),
  defaultTimezone: 'Asia/Singapore',
  autoSetWebhook: false,
  version: 'test',
};

function fakeBotCtx(appUser: User, match: string): BotContext {
  return {
    appUser,
    match,
    reply: vi.fn().mockResolvedValue(undefined),
    replyWithDocument: vi.fn().mockResolvedValue(undefined),
  } as unknown as BotContext;
}

function mock(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>;
}

describe('exportUsageText', () => {
  const lines = (startDay: number) =>
    exportUsageText(cycleContaining('2026-10-31' as IsoDate, startDay));

  it('the usage hint lists everything, cycle, last cycle, year and month', () => {
    const day20 = lines(20);
    expect(day20).toContain('`/export` — everything');
    expect(day20).toContain('`/export cycle` — this cycle (20 Oct – 19 Nov)');
    expect(day20).toContain('`/export last cycle` — last cycle (20 Sep – 19 Oct)');
    expect(day20).toContain('`/export 2026`');
    expect(day20).toContain('`/export 2026-08`');

    const day1 = lines(1);
    expect(day1).toContain('`/export` — everything');
    expect(day1).toContain('`/export cycle` — this month');
    expect(day1).toContain('`/export last cycle` — last month');
    expect(day1).not.toContain('(1 Oct');
    expect(day1).not.toContain('cycle (');
    expect(day1).toContain('`/export 2026`');
    expect(day1).toContain('`/export 2026-08`');
  });
});

describeIfDb('/export (DB)', () => {
  let handle: DatabaseHandle;
  let user: User;
  let spaceId: string;
  const ctx: AppContext = {
    config,
    db: {} as never,
    dbHandle: null as never,
    clock: fixedClock(OCT_31),
  };

  async function cleanUp(): Promise<void> {
    const rows = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.telegramId, TELEGRAM_A));
    for (const row of rows) {
      await handle.db.delete(schema.transactions).where(eq(schema.transactions.userId, row.id));
      await handle.db.delete(schema.households).where(eq(schema.households.createdBy, row.id));
    }
    await handle.db.delete(schema.users).where(eq(schema.users.telegramId, TELEGRAM_A));
  }

  async function log(occurredOn: string): Promise<void> {
    await transactionsRepo.create(handle.db, {
      userId: user.id,
      householdId: spaceId,
      direction: 'out',
      amountCents: 5_000,
      categoryId: null,
      note: null,
      occurredOn,
      source: 'chat',
    });
  }

  beforeAll(() => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    Object.assign(ctx, { db: handle.db, dbHandle: handle });
  });

  beforeEach(async () => {
    await cleanUp();
    user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: TELEGRAM_A,
      timezone: 'Asia/Singapore',
    });
    spaceId = (await householdsRepo.personalSpaceOf(handle.db, user.id)).id;
    await householdsRepo.updateCycleStartDay(handle.db, spaceId, 20);
  });

  afterAll(async () => {
    await cleanUp();
    await handle.close();
  });

  it('an unknown argument replies with the usage hint for the space cycle', async () => {
    const botCtx = fakeBotCtx(user, 'lastcycle2');
    await handleExport(ctx, botCtx);
    expect(botCtx.replyWithDocument).not.toHaveBeenCalled();
    const text = mock(botCtx.reply).mock.calls[0]?.[0] as string;
    expect(text).toContain('this cycle (20 Oct – 19 Nov)');
    expect(text).toContain('last cycle (20 Sep – 19 Oct)');
  });

  it('an empty last cycle says nothing was logged for its range', async () => {
    await log('2026-10-25'); // in this cycle only
    const botCtx = fakeBotCtx(user, 'last cycle');
    await handleExport(ctx, botCtx);
    expect(botCtx.reply).toHaveBeenCalledWith('Nothing logged for 20 Sep – 19 Oct.');
    expect(botCtx.replyWithDocument).not.toHaveBeenCalled();
  });

  it('/export cycle sends one file named by dates with a range caption', async () => {
    await log('2026-10-25');
    await log('2026-10-05'); // previous cycle: must not be counted
    const botCtx = fakeBotCtx(user, 'cycle');
    await handleExport(ctx, botCtx);

    expect(botCtx.replyWithDocument).toHaveBeenCalledTimes(1);
    const [file, options] = mock(botCtx.replyWithDocument).mock.calls[0] as [
      InputFile,
      { caption: string },
    ];
    expect(file).toBeInstanceOf(InputFile);
    expect(file.filename).toBe('spendlygo_2026-10-20_to_2026-11-19.csv');
    expect(options.caption).toBe('1 entry · 20 Oct – 19 Nov');
  });

  it('/export with no argument still sends everything, as today', async () => {
    await log('2026-10-25');
    await log('2026-10-05');
    const botCtx = fakeBotCtx(user, '');
    await handleExport(ctx, botCtx);

    const [file, options] = mock(botCtx.replyWithDocument).mock.calls[0] as [
      InputFile,
      { caption: string },
    ];
    expect(file.filename).toBe('spendlygo-all-time.csv');
    expect(options.caption).toBe('2 entries · all-time');
  });
});
