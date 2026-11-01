/**
 * Migration tests for the budget_periods rebuild (B-032 Part 5, P5-AC3, AC4, AC33).
 * Written before the migration files (0006 to 0009) exist.
 *
 * (a) guard and seed SQL run on the shared test DB inside transactions that
 *     are always rolled back, so the shared DB is never changed.
 * (b) the rehearsal runs on a scratch database migrated to 0005 only.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, householdsRepo, schema, usersRepo, type DatabaseHandle } from './index.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
const readMigration = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

const TELEGRAM_A = 980000000001n;
const TELEGRAM_B = 980000000002n;

/** Thrown inside a transaction to force the rollback after the assertions are captured. */
class Rollback extends Error {}

describeIfDb('guard SQL', () => {
  let handle: DatabaseHandle;
  let raw: ReturnType<typeof postgres>;
  let spaceId: string;

  async function cleanUp(): Promise<void> {
    const rows = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.telegramId, [TELEGRAM_A, TELEGRAM_B]));
    const ids = rows.map((row) => row.id);
    if (ids.length > 0) {
      await handle.db.delete(schema.households).where(inArray(schema.households.createdBy, ids));
    }
    for (const telegramId of [TELEGRAM_A, TELEGRAM_B]) {
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, telegramId));
    }
  }

  beforeAll(() => {
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    raw = postgres(TEST_DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {} });
  });
  beforeEach(async () => {
    await cleanUp();
    const user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: TELEGRAM_A,
      timezone: 'Asia/Singapore',
    });
    spaceId = (await householdsRepo.personalSpaceOf(handle.db, user.id)).id;
  });
  afterAll(async () => {
    await cleanUp();
    await raw.end();
    await handle.close();
  });

  it('raises on a non-empty budget_periods and passes an empty one', async () => {
    const guard = readMigration('0006_budget_periods_guard.sql');

    let message = '';
    await raw
      .begin(async (tx) => {
        await tx.unsafe(
          `INSERT INTO budget_periods (household_id, effective_from, budget_cents)
           VALUES ('${spaceId}', '2026-01-01', 100)`,
        );
        try {
          await tx.unsafe(guard);
        } catch (error) {
          message = (error as Error).message;
        }
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(message).toContain('budget_periods');
    expect(message).toContain('refusing');

    // Empty: the guard succeeds and changes nothing.
    let countAfter = -1;
    await raw
      .begin(async (tx) => {
        await tx.unsafe('DELETE FROM budget_periods');
        await tx.unsafe(guard);
        countAfter = Number((await tx.unsafe('SELECT count(*) AS n FROM budget_periods'))[0]?.n);
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(countAfter).toBe(0);
  });
});

describeIfDb('seed SQL', () => {
  let handle: DatabaseHandle;
  let raw: ReturnType<typeof postgres>;

  async function cleanUp(): Promise<void> {
    const rows = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.telegramId, [TELEGRAM_A, TELEGRAM_B]));
    const ids = rows.map((row) => row.id);
    if (ids.length > 0) {
      await handle.db.delete(schema.households).where(inArray(schema.households.createdBy, ids));
    }
    for (const telegramId of [TELEGRAM_A, TELEGRAM_B]) {
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, telegramId));
    }
  }

  beforeAll(() => {
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    raw = postgres(TEST_DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {} });
  });
  beforeEach(cleanUp);
  afterAll(async () => {
    await cleanUp();
    await raw.end();
    await handle.close();
  });

  it("copies each space's budget from 1970-01-01, skips no-budget spaces, and is re-runnable", async () => {
    const a = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: TELEGRAM_A,
      timezone: 'Asia/Singapore',
    });
    const b = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: TELEGRAM_B,
      timezone: 'Asia/Singapore',
    });
    const spaceA = (await householdsRepo.personalSpaceOf(handle.db, a.id)).id;
    const spaceB = (await householdsRepo.personalSpaceOf(handle.db, b.id)).id;
    const seed = readMigration('0009_budget_periods_seed.sql');

    const rowsFor = async (tx: postgres.TransactionSql) =>
      (await tx.unsafe(
        `SELECT household_id, effective_from::text AS d, budget_cents
         FROM budget_periods WHERE household_id IN ('${spaceA}', '${spaceB}')
         ORDER BY household_id, effective_from`,
      )) as unknown as Array<{ household_id: string; d: string; budget_cents: number | null }>;

    let first: Awaited<ReturnType<typeof rowsFor>> = [];
    let second: Awaited<ReturnType<typeof rowsFor>> = [];
    await raw
      .begin(async (tx) => {
        await tx.unsafe(
          `UPDATE households SET monthly_budget_cents = 35000 WHERE id = '${spaceA}'`,
        );
        await tx.unsafe(`UPDATE households SET monthly_budget_cents = NULL WHERE id = '${spaceB}'`);
        await tx.unsafe(
          `DELETE FROM budget_periods WHERE household_id IN ('${spaceA}', '${spaceB}')`,
        );
        await tx.unsafe(seed);
        first = await rowsFor(tx);
        await tx.unsafe(seed);
        second = await rowsFor(tx);
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });

    expect(first).toEqual([{ household_id: spaceA, d: '1970-01-01', budget_cents: 35_000 }]);
    expect(second).toEqual(first);
  });
});

describeIfDb('rehearsal', () => {
  const scratchName = `spendlygo_p5_rehearsal_${process.pid}_${Date.now()}`;
  let admin: ReturnType<typeof postgres>;
  let scratch: ReturnType<typeof postgres> | undefined;
  let scratchUrl = '';
  let copyDir = '';

  beforeAll(async () => {
    admin = postgres(TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE "${scratchName}"`);
    const url = new URL(TEST_DATABASE_URL as string);
    url.pathname = `/${scratchName}`;
    scratchUrl = url.toString();

    // A copy of the migrations folder whose journal stops at 0005.
    copyDir = mkdtempSync(join(tmpdir(), 'spendlygo-p5-'));
    cpSync(MIGRATIONS, copyDir, { recursive: true });
    const journalPath = join(copyDir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 5);
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  });

  afterAll(async () => {
    await scratch?.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await admin.end();
    if (copyDir) rmSync(copyDir, { recursive: true, force: true });
  });

  it('a filled database at 0005 refuses the whole batch, then upgrades once emptied', async () => {
    scratch = postgres(scratchUrl, { max: 1, prepare: false, onnotice: () => {} });
    const db = drizzle(scratch, { schema });

    await migrate(drizzle(scratch), { migrationsFolder: copyDir });

    const userA = await usersRepo.upsertByTelegramId(db, {
      telegramId: TELEGRAM_A,
      timezone: 'Asia/Singapore',
    });
    const userB = await usersRepo.upsertByTelegramId(db, {
      telegramId: TELEGRAM_B,
      timezone: 'Asia/Singapore',
    });
    const spaceA = (await householdsRepo.personalSpaceOf(db, userA.id)).id;
    const spaceB = (await householdsRepo.personalSpaceOf(db, userB.id)).id;
    await scratch.unsafe(
      `UPDATE households SET monthly_budget_cents = 35000 WHERE id = '${spaceA}'`,
    );
    await scratch.unsafe(
      `INSERT INTO budget_periods (user_id, year, month, budget_cents)
       VALUES ('${userA.id}', 2026, 1, 1)`,
    );

    // 0006 to 0009 pending, table not empty: the first run throws, the batch rolls back.
    await expect(migrate(drizzle(scratch), { migrationsFolder: MIGRATIONS })).rejects.toThrow(
      /refusing/,
    );
    const columns = (
      await scratch.unsafe(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'budget_periods'`,
      )
    ).map((row) => row.column_name as string);
    expect(columns).toContain('user_id');
    expect(columns).not.toContain('household_id');
    expect(Number((await scratch.unsafe('SELECT count(*) AS n FROM budget_periods'))[0]?.n)).toBe(
      1,
    );
    expect(
      Number(
        (await scratch.unsafe('SELECT count(*) AS n FROM drizzle.__drizzle_migrations'))[0]?.n,
      ),
    ).toBe(6);

    // Emptied: the second run succeeds.
    await scratch.unsafe('DELETE FROM budget_periods');
    await migrate(drizzle(scratch), { migrationsFolder: MIGRATIONS });
    expect(
      Number(
        (await scratch.unsafe('SELECT count(*) AS n FROM drizzle.__drizzle_migrations'))[0]?.n,
      ),
    ).toBe(10);
    const seeded = await scratch.unsafe(
      `SELECT household_id, effective_from::text AS d, budget_cents FROM budget_periods`,
    );
    expect(seeded.map((row) => ({ ...row }))).toEqual([
      { household_id: spaceA, d: '1970-01-01', budget_cents: 35_000 },
    ]);
    expect(seeded.some((row) => row.household_id === spaceB)).toBe(false);
  }, 60_000);
});
