/**
 * Integration tests for household membership and invites.
 *
 * GUARDRAILS.md section 4: an invite code is authorisation to join a
 * household, nothing more — and it must be usable exactly once, even under a
 * race, since two people racing to claim one invite is a realistic scenario
 * (both partners tapping a shared link at once).
 */

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, schema, usersRepo, type DatabaseHandle } from '../index.js';
import { JoinHouseholdError } from './households.js';
import * as householdsRepo from './households.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const CREATOR_TELEGRAM_ID = 960000000001n;
const PARTNER_TELEGRAM_ID = 960000000002n;
const STRANGER_TELEGRAM_ID = 960000000003n;

describeIfDb('households', () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 3 });
  });

  /**
   * Households have `created_by ... ON DELETE RESTRICT` — deliberately, so a
   * household can never be silently orphaned by its creator disappearing.
   * That means test cleanup must delete households before the users who
   * created them, not the other way around.
   */
  async function cleanUp(): Promise<void> {
    const testUsers = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        inArray(schema.users.telegramId, [
          CREATOR_TELEGRAM_ID,
          PARTNER_TELEGRAM_ID,
          STRANGER_TELEGRAM_ID,
        ]),
      );
    const ids = testUsers.map((u) => u.id);
    if (ids.length > 0) {
      await handle.db.delete(schema.households).where(inArray(schema.households.createdBy, ids));
    }
    for (const id of [CREATOR_TELEGRAM_ID, PARTNER_TELEGRAM_ID, STRANGER_TELEGRAM_ID]) {
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, id));
    }
  }

  beforeEach(cleanUp);

  afterAll(async () => {
    await cleanUp();
    await handle.close();
  });

  async function makeUser(telegramId: bigint, monthlyBudgetCents: number | null = null) {
    const user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId,
      timezone: 'Asia/Singapore',
    });
    if (monthlyBudgetCents !== null) {
      await usersRepo.updateSettings(handle.db, user.id, { monthlyBudgetCents });
    }
    return (await usersRepo.findById(handle.db, user.id))!;
  }

  describe('create', () => {
    it('seeds the household budget from the creator personal budget', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID, 150_000);
      const household = await householdsRepo.create(handle.db, creator.id);
      expect(household.monthlyBudgetCents).toBe(150_000);
      expect(household.createdBy).toBe(creator.id);
    });

    it('moves the creator into the household immediately', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);

      const refreshed = await usersRepo.findById(handle.db, creator.id);
      expect(refreshed?.householdId).toBe(household.id);
    });

    it('refuses to create a second household for someone already in one', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      await householdsRepo.create(handle.db, creator.id);

      await expect(householdsRepo.create(handle.db, creator.id)).rejects.toThrow(
        JoinHouseholdError,
      );
    });
  });

  describe('createInvite / joinByCode', () => {
    it('lets a second user join with a valid code', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const partner = await makeUser(PARTNER_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);
      const invite = await householdsRepo.createInvite(handle.db, household.id, creator.id);

      const joined = await householdsRepo.joinByCode(handle.db, invite.code, partner.id);
      expect(joined.id).toBe(household.id);

      const members = await householdsRepo.membersOf(handle.db, household.id);
      expect(members.map((m) => m.id).sort()).toEqual([creator.id, partner.id].sort());
    });

    it('is case-insensitive, since people retype codes by hand', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const partner = await makeUser(PARTNER_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);
      const invite = await householdsRepo.createInvite(handle.db, household.id, creator.id);

      await expect(
        householdsRepo.joinByCode(handle.db, invite.code.toLowerCase(), partner.id),
      ).resolves.toMatchObject({ id: household.id });
    });

    it('rejects a code that does not exist', async () => {
      const stranger = await makeUser(STRANGER_TELEGRAM_ID);
      await expect(householdsRepo.joinByCode(handle.db, 'NOTREAL', stranger.id)).rejects.toThrow(
        JoinHouseholdError,
      );
    });

    it('rejects the creator using their own invite', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);
      const invite = await householdsRepo.createInvite(handle.db, household.id, creator.id);

      await expect(householdsRepo.joinByCode(handle.db, invite.code, creator.id)).rejects.toThrow(
        JoinHouseholdError,
      );
    });

    it('rejects joining twice with the same code', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const partner = await makeUser(PARTNER_TELEGRAM_ID);
      const stranger = await makeUser(STRANGER_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);
      const invite = await householdsRepo.createInvite(handle.db, household.id, creator.id);

      await householdsRepo.joinByCode(handle.db, invite.code, partner.id);

      await expect(householdsRepo.joinByCode(handle.db, invite.code, stranger.id)).rejects.toThrow(
        JoinHouseholdError,
      );
    });

    it('rejects someone who already belongs to a household', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const partner = await makeUser(PARTNER_TELEGRAM_ID);
      await householdsRepo.create(handle.db, creator.id);
      await householdsRepo.create(handle.db, partner.id);

      const invite = await householdsRepo.createInvite(
        handle.db,
        (await usersRepo.findById(handle.db, creator.id))!.householdId!,
        creator.id,
      );

      await expect(householdsRepo.joinByCode(handle.db, invite.code, partner.id)).rejects.toThrow(
        JoinHouseholdError,
      );
    });

    it('rejects an expired invite', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const partner = await makeUser(PARTNER_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);
      const invite = await householdsRepo.createInvite(handle.db, household.id, creator.id);

      // Force it into the past directly — the repo always creates one 24h out.
      await handle.db
        .update(schema.householdInvites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.householdInvites.code, invite.code));

      await expect(householdsRepo.joinByCode(handle.db, invite.code, partner.id)).rejects.toThrow(
        JoinHouseholdError,
      );
    });

    it('never lets two racing joins both succeed on the same code', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const partner = await makeUser(PARTNER_TELEGRAM_ID);
      const stranger = await makeUser(STRANGER_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);
      const invite = await householdsRepo.createInvite(handle.db, household.id, creator.id);

      const results = await Promise.allSettled([
        householdsRepo.joinByCode(handle.db, invite.code, partner.id),
        householdsRepo.joinByCode(handle.db, invite.code, stranger.id),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded).toHaveLength(1);

      const members = await householdsRepo.membersOf(handle.db, household.id);
      expect(members).toHaveLength(2); // creator + exactly one joiner
    });
  });

  describe('leave', () => {
    it('returns the user to solo tracking', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      await householdsRepo.create(handle.db, creator.id);

      await householdsRepo.leave(handle.db, creator.id);

      const refreshed = await usersRepo.findById(handle.db, creator.id);
      expect(refreshed?.householdId).toBeNull();
    });

    it('lets them create or join a new household afterward', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      await householdsRepo.create(handle.db, creator.id);
      await householdsRepo.leave(handle.db, creator.id);

      await expect(householdsRepo.create(handle.db, creator.id)).resolves.toBeTruthy();
    });
  });

  describe('updateBudget', () => {
    it('is visible to every member', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const partner = await makeUser(PARTNER_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);
      const invite = await householdsRepo.createInvite(handle.db, household.id, creator.id);
      await householdsRepo.joinByCode(handle.db, invite.code, partner.id);

      // Either partner can be the one who calls this — the API layer does not
      // check who created the household, only that the caller is a member.
      await householdsRepo.updateBudget(handle.db, household.id, 200_000);

      const reread = await householdsRepo.findById(handle.db, household.id);
      expect(reread?.monthlyBudgetCents).toBe(200_000);
    });
  });
});
