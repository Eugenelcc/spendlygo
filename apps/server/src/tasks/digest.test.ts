import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '@spendlygo/core';
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
import { buildDigest } from './digest.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const TELEGRAM_ID = 930000000001n;
const TODAY = '2026-08-27';

describeIfDb('buildDigest', () => {
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
