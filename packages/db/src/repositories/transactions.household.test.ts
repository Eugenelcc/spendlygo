/**
 * Integration tests for space-scoped transaction reads.
 *
 * Every transaction belongs to exactly one space (`household_id`, NOT NULL —
 * see the doc comment at the top of transactions.ts) — the one active when it
 * was logged. There is one filter, `scopedTo(householdId)`, used by both the
 * History feed and every aggregate. These tests exist to prove that filter
 * actually separates spaces: two members of a shared space see the same
 * entries and totals, a personal space stays invisible from a shared one and
 * vice versa, and leaving a shared space returns the leaver to their
 * personal one without moving or deleting anything they logged.
 */

import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, schema, usersRepo, type DatabaseHandle } from '../index.js';
import * as householdsRepo from './households.js';
import * as transactionsRepo from './transactions.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const CREATOR_TELEGRAM_ID = 970000000001n;
const PARTNER_TELEGRAM_ID = 970000000002n;

describeIfDb('space-scoped transactions', () => {
  let handle: DatabaseHandle;
  let creatorId: string;
  let partnerId: string;
  let creatorPersonalId: string;
  let partnerPersonalId: string;
  let sharedId: string;

  beforeAll(async () => {
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 3 });
  });

  /**
   * Two phases, not one loop: the partner can log into a space the creator
   * created, so a transaction referencing that space can belong to EITHER
   * test user. Every test user's transactions must be gone before deleting
   * any test user's households, or the still-referenced household 400s the
   * delete (`transactions_household_id_households_id_fk`, RESTRICT).
   */
  async function cleanUp(): Promise<void> {
    const ids = [CREATOR_TELEGRAM_ID, PARTNER_TELEGRAM_ID];
    const rows = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.telegramId, ids));
    const userIds = rows.map((row) => row.id);

    if (userIds.length > 0) {
      await handle.db
        .delete(schema.transactions)
        .where(inArray(schema.transactions.userId, userIds));
      await handle.db
        .delete(schema.households)
        .where(inArray(schema.households.createdBy, userIds));
    }
    await handle.db.delete(schema.users).where(inArray(schema.users.telegramId, ids));
  }

  beforeEach(async () => {
    await cleanUp();

    const creator = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: CREATOR_TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
    creatorId = creator.id;
    creatorPersonalId = (await householdsRepo.personalSpaceOf(handle.db, creatorId)).id;

    // Logged in the creator's personal space, before any shared one exists.
    await transactionsRepo.create(handle.db, {
      userId: creatorId,
      householdId: creatorPersonalId,
      direction: 'out',
      amountCents: 5000,
      categoryId: null,
      note: 'personal grocery run',
      occurredOn: '2026-08-01',
      source: 'chat',
    });

    const shared = await householdsRepo.create(handle.db, creatorId);
    sharedId = shared.id;

    const partner = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: PARTNER_TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
    partnerId = partner.id;
    partnerPersonalId = (await householdsRepo.personalSpaceOf(handle.db, partnerId)).id;

    const invite = await householdsRepo.createInvite(handle.db, sharedId, creatorId);
    await householdsRepo.joinByCode(handle.db, invite.code, partnerId);

    // Both partners log something in the now-shared space.
    await transactionsRepo.create(handle.db, {
      userId: creatorId,
      householdId: sharedId,
      direction: 'out',
      amountCents: 3000,
      categoryId: null,
      note: 'creator shared spend',
      occurredOn: '2026-08-15',
      source: 'chat',
    });
    await transactionsRepo.create(handle.db, {
      userId: partnerId,
      householdId: sharedId,
      direction: 'out',
      amountCents: 2000,
      categoryId: null,
      note: 'partner shared spend',
      occurredOn: '2026-08-16',
      source: 'chat',
    });
  });

  afterAll(async () => {
    await cleanUp();
    await handle.close();
  });

  describe('list', () => {
    it("keeps the creator's personal-space history out of the shared space", async () => {
      const rows = await transactionsRepo.list(handle.db, sharedId, { limit: 10 });
      const notes = rows.map((r) => r.note);
      expect(notes).not.toContain('personal grocery run');
      expect(notes).toContain('creator shared spend');
      expect(notes).toContain('partner shared spend');
    });

    it('shows the creator only their own entry when viewing their personal space', async () => {
      const rows = await transactionsRepo.list(handle.db, creatorPersonalId, { limit: 10 });
      const notes = rows.map((r) => r.note);
      expect(notes).toEqual(['personal grocery run']);
    });

    it("never mixes one member's personal space into another's", async () => {
      const rows = await transactionsRepo.list(handle.db, partnerPersonalId, { limit: 10 });
      expect(rows).toHaveLength(0);
    });

    it('shows the author on every row, so the Mini App can label whose entry it is', async () => {
      const rows = await transactionsRepo.list(handle.db, sharedId, { limit: 10 });
      const shared = rows.find((r) => r.note === 'creator shared spend');
      expect(shared?.userId).toBe(creatorId);
    });
  });

  describe('totalsForPeriod', () => {
    it('sums only the shared space, excluding personal-space spending', async () => {
      const totals = await transactionsRepo.totalsForPeriod(
        handle.db,
        sharedId,
        '2026-08-01',
        '2026-08-31',
      );
      // 3000 + 2000 shared, NOT +5000 from the creator's personal space.
      expect(totals.outCents).toBe(5000);
      expect(totals.count).toBe(2);
    });

    it('is the identical figure whichever member asks — the whole point of a shared space', async () => {
      // Both partners are asking about the SAME space id; nothing here is
      // keyed by who is asking, only by which space.
      const totals = await transactionsRepo.totalsForPeriod(
        handle.db,
        sharedId,
        '2026-08-01',
        '2026-08-31',
      );
      expect(totals.outCents).toBe(5000);
    });
  });

  describe('after leaving the shared space', () => {
    it('falls back to the personal space as active, without touching anything logged', async () => {
      await householdsRepo.leave(handle.db, creatorId, sharedId);

      const refreshed = await usersRepo.findById(handle.db, creatorId);
      expect(refreshed?.activeHouseholdId).toBe(creatorPersonalId);

      // The entry logged while in the shared space stays exactly where it
      // was logged — leaving never moves or deletes history.
      const sharedRows = await transactionsRepo.list(handle.db, sharedId, { limit: 10 });
      expect(sharedRows.map((r) => r.note)).toContain('creator shared spend');

      const personalRows = await transactionsRepo.list(handle.db, creatorPersonalId, {
        limit: 10,
      });
      expect(personalRows.map((r) => r.note)).toEqual(['personal grocery run']);
    });
  });
});
