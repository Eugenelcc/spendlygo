/**
 * Integration test for the budget history lookup (B-032 Part 5, P5-AC12).
 * Written before the feature exists.
 */

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  budgetPeriodsRepo,
  createDatabase,
  householdsRepo,
  schema,
  usersRepo,
  type DatabaseHandle,
} from '../index.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const TELEGRAM_IDS = [970000000001n, 970000000002n, 970000000003n];

describeIfDb('budgetInEffectOn', () => {
  let handle: DatabaseHandle;

  beforeAll(() => {
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 3 });
  });

  // Households are `restrict` on their creator, so delete them before users.
  async function cleanUp(): Promise<void> {
    const rows = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.telegramId, TELEGRAM_IDS));
    const ids = rows.map((row) => row.id);
    if (ids.length > 0) {
      await handle.db.delete(schema.households).where(inArray(schema.households.createdBy, ids));
    }
    for (const telegramId of TELEGRAM_IDS) {
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, telegramId));
    }
  }

  beforeEach(cleanUp);
  afterAll(async () => {
    await cleanUp();
    await handle.close();
  });

  async function personalSpace(telegramId: bigint) {
    const user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId,
      timezone: 'Asia/Singapore',
    });
    return householdsRepo.personalSpaceOf(handle.db, user.id);
  }

  it('the latest change on or before the date, per space', async () => {
    const s = await personalSpace(TELEGRAM_IDS[0] as bigint);
    const t = await personalSpace(TELEGRAM_IDS[1] as bigint);
    const u = await personalSpace(TELEGRAM_IDS[2] as bigint);

    await householdsRepo.updateBudget(handle.db, s.id, 35_000, '1970-01-01');
    await householdsRepo.updateBudget(handle.db, s.id, 50_000, '2026-03-05');
    await householdsRepo.updateBudget(handle.db, s.id, null, '2026-06-01');
    await householdsRepo.updateBudget(handle.db, t.id, 99_900, '1970-01-01');

    const on = (spaceId: string, date: string) =>
      budgetPeriodsRepo.budgetInEffectOn(handle.db, spaceId, date);

    expect(await on(s.id, '2026-02-19')).toBe(35_000);
    expect(await on(s.id, '2026-03-04')).toBe(35_000);
    expect(await on(s.id, '2026-03-05')).toBe(50_000);
    expect(await on(s.id, '2026-05-31')).toBe(50_000);
    expect(await on(s.id, '2026-06-01')).toBeNull();
    expect(await on(u.id, '2026-03-05')).toBeNull();

    // Space isolation: T's rows never leak into S's answers, nor S's into T's.
    expect(await on(t.id, '2026-03-05')).toBe(99_900);
    expect(await on(t.id, '2026-06-01')).toBe(99_900);
  });
});
