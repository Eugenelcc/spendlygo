/**
 * Integration tests for spaces: personal (auto-created, never left or
 * invited into), shared (joined by invite code), membership, and switching
 * which one is active.
 *
 * GUARDRAILS.md section 4: an invite code is authorisation to join a
 * household, nothing more — and it must be usable exactly once, even under a
 * race, since two people racing to claim one invite is a realistic scenario
 * (both partners tapping a shared link at once).
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  budgetPeriodsRepo,
  createDatabase,
  schema,
  usersRepo,
  type DatabaseHandle,
} from '../index.js';
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
      await handle.db.delete(schema.transactions).where(inArray(schema.transactions.userId, ids));
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

  async function makeUser(telegramId: bigint) {
    const user = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId,
      timezone: 'Asia/Singapore',
    });
    return (await usersRepo.findById(handle.db, user.id))!;
  }

  describe('personal spaces', () => {
    it('every new user gets one automatically, active from the start', async () => {
      const user = await makeUser(CREATOR_TELEGRAM_ID);
      const personal = await householdsRepo.personalSpaceOf(handle.db, user.id);

      expect(personal.isPersonal).toBe(true);
      expect(personal.createdBy).toBe(user.id);
      expect(user.activeHouseholdId).toBe(personal.id);

      const spaces = await householdsRepo.mySpaces(handle.db, user.id);
      expect(spaces.map((s) => s.id)).toEqual([personal.id]);
    });
  });

  describe('create', () => {
    it('starts a new shared space with no budget set', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);

      expect(household.isPersonal).toBe(false);
      expect(household.monthlyBudgetCents).toBeNull();
      expect(household.createdBy).toBe(creator.id);
    });

    it('moves the creator into it as active, without dropping their personal space', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const personal = await householdsRepo.personalSpaceOf(handle.db, creator.id);
      const household = await householdsRepo.create(handle.db, creator.id);

      const refreshed = await usersRepo.findById(handle.db, creator.id);
      expect(refreshed?.activeHouseholdId).toBe(household.id);

      const spaces = await householdsRepo.mySpaces(handle.db, creator.id);
      expect(spaces.map((s) => s.id).sort()).toEqual([household.id, personal.id].sort());
    });

    it('lets someone create more than one shared space', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const first = await householdsRepo.create(handle.db, creator.id);
      const second = await householdsRepo.create(handle.db, creator.id);

      expect(first.id).not.toBe(second.id);
      const spaces = await householdsRepo.mySpaces(handle.db, creator.id);
      expect(spaces.map((s) => s.id)).toEqual(expect.arrayContaining([first.id, second.id]));
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

      const refreshedPartner = await usersRepo.findById(handle.db, partner.id);
      expect(refreshedPartner?.activeHouseholdId).toBe(household.id);
    });

    it('lets someone already in a different shared space join another one too', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const partner = await makeUser(PARTNER_TELEGRAM_ID);
      const partnerOwnSpace = await householdsRepo.create(handle.db, partner.id);
      const household = await householdsRepo.create(handle.db, creator.id);
      const invite = await householdsRepo.createInvite(handle.db, household.id, creator.id);

      await expect(
        householdsRepo.joinByCode(handle.db, invite.code, partner.id),
      ).resolves.toMatchObject({ id: household.id });

      const spaces = await householdsRepo.mySpaces(handle.db, partner.id);
      expect(spaces.map((s) => s.id)).toEqual(
        expect.arrayContaining([partnerOwnSpace.id, household.id]),
      );
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

    it('rejects someone already a member of that exact space', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const partner = await makeUser(PARTNER_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);
      const firstInvite = await householdsRepo.createInvite(handle.db, household.id, creator.id);
      await householdsRepo.joinByCode(handle.db, firstInvite.code, partner.id);

      const secondInvite = await householdsRepo.createInvite(handle.db, household.id, creator.id);
      await expect(
        householdsRepo.joinByCode(handle.db, secondInvite.code, partner.id),
      ).rejects.toThrow(JoinHouseholdError);
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

    it('rejects an invite created by someone no longer a member', async () => {
      const stranger = await makeUser(STRANGER_TELEGRAM_ID);
      await expect(
        householdsRepo.createInvite(
          handle.db,
          (await householdsRepo.create(handle.db, stranger.id)).id,
          '00000000-0000-4000-8000-000000000000',
        ),
      ).rejects.toThrow(JoinHouseholdError);
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
    it('refuses to leave the personal space', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const personal = await householdsRepo.personalSpaceOf(handle.db, creator.id);

      await expect(householdsRepo.leave(handle.db, creator.id, personal.id)).rejects.toThrow(
        JoinHouseholdError,
      );
    });

    it('falls back to the personal space when leaving the active one', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const personal = await householdsRepo.personalSpaceOf(handle.db, creator.id);
      const household = await householdsRepo.create(handle.db, creator.id);

      await householdsRepo.leave(handle.db, creator.id, household.id);

      const refreshed = await usersRepo.findById(handle.db, creator.id);
      expect(refreshed?.activeHouseholdId).toBe(personal.id);

      const spaces = await householdsRepo.mySpaces(handle.db, creator.id);
      expect(spaces.map((s) => s.id)).toEqual([personal.id]);
    });

    it('leaves the active space alone when leaving a DIFFERENT, inactive one', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const first = await householdsRepo.create(handle.db, creator.id);
      const second = await householdsRepo.create(handle.db, creator.id); // becomes active

      await householdsRepo.leave(handle.db, creator.id, first.id);

      const refreshed = await usersRepo.findById(handle.db, creator.id);
      expect(refreshed?.activeHouseholdId).toBe(second.id);
    });

    it('lets them create or join a new household afterward', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);
      await householdsRepo.leave(handle.db, creator.id, household.id);

      await expect(householdsRepo.create(handle.db, creator.id)).resolves.toBeTruthy();
    });
  });

  describe('switchActive', () => {
    it('switches between spaces the user actually belongs to', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const personal = await householdsRepo.personalSpaceOf(handle.db, creator.id);
      const household = await householdsRepo.create(handle.db, creator.id); // active now

      await householdsRepo.switchActive(handle.db, creator.id, personal.id);
      expect((await usersRepo.findById(handle.db, creator.id))?.activeHouseholdId).toBe(
        personal.id,
      );

      await householdsRepo.switchActive(handle.db, creator.id, household.id);
      expect((await usersRepo.findById(handle.db, creator.id))?.activeHouseholdId).toBe(
        household.id,
      );
    });

    it("refuses to switch into a space the user isn't a member of", async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const stranger = await makeUser(STRANGER_TELEGRAM_ID);
      const strangersSpace = await householdsRepo.create(handle.db, stranger.id);

      await expect(
        householdsRepo.switchActive(handle.db, creator.id, strangersSpace.id),
      ).rejects.toThrow(JoinHouseholdError);
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
      await householdsRepo.updateBudget(handle.db, household.id, 200_000, '2026-10-31');

      const reread = await householdsRepo.findById(handle.db, household.id);
      expect(reread?.monthlyBudgetCents).toBe(200_000);
    });
  });
  describe('cycle start day', () => {
    it('defaults to 1 and the CHECK rejects 0 and 32', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);
      expect(household.cycleStartDay).toBe(1);

      for (const bad of [0, 32]) {
        await expect(
          handle.db.execute(
            sql`UPDATE households SET cycle_start_day = ${bad} WHERE id = ${household.id}`,
          ),
        ).rejects.toThrow(/households_cycle_start_day_ck/);
      }
      const reread = await householdsRepo.findById(handle.db, household.id);
      expect(reread?.cycleStartDay).toBe(1);
    });

    it('updateCycleStartDay reports whether it changed anything', async () => {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const household = await householdsRepo.create(handle.db, creator.id);

      await expect(householdsRepo.updateCycleStartDay(handle.db, household.id, 20)).resolves.toBe(
        true,
      );
      const afterFirst = await householdsRepo.findById(handle.db, household.id);
      expect(afterFirst?.cycleStartDay).toBe(20);

      await expect(householdsRepo.updateCycleStartDay(handle.db, household.id, 20)).resolves.toBe(
        false,
      );
      const afterSecond = await householdsRepo.findById(handle.db, household.id);
      expect(afterSecond?.updatedAt.getTime()).toBe(afterFirst?.updatedAt.getTime());

      await expect(
        householdsRepo.updateCycleStartDay(handle.db, '00000000-0000-4000-8000-000000000000', 20),
      ).rejects.toThrow(/No household/);
    });
  });
  // --- Part 5 (B-032): budget history, P5-AC5 to AC11 ---------------------------

  describe('budget history (B-032 P5)', () => {
    async function spaceWithBudget(budget: number | null = null, since?: string) {
      const creator = await makeUser(CREATOR_TELEGRAM_ID);
      const space = await householdsRepo.create(handle.db, creator.id);
      if (budget !== null && since) {
        await householdsRepo.updateBudget(handle.db, space.id, budget, since);
      }
      return { creator, space };
    }

    const changes = async (spaceId: string) =>
      (await budgetPeriodsRepo.listForSpace(handle.db, spaceId)).map((row) => ({
        effectiveFrom: row.effectiveFrom,
        budgetCents: row.budgetCents,
      }));

    it('the table rejects negatives, duplicate dates and unknown spaces, and accepts null', async () => {
      const { space } = await spaceWithBudget();
      const insert = (spaceId: string, date: string, cents: number | null) =>
        handle.db.execute(
          sql`INSERT INTO budget_periods (household_id, effective_from, budget_cents)
              VALUES (${spaceId}, ${date}, ${cents})`,
        );

      await expect(insert(space.id, '2026-01-01', -1)).rejects.toThrow(/budget_periods_budget_ck/);
      await insert(space.id, '2026-01-01', 100);
      await expect(insert(space.id, '2026-01-01', 200)).rejects.toThrow(
        /budget_periods_household_effective_uq/,
      );
      await insert(space.id, '2026-02-01', null); // null = "no budget"
      await expect(
        insert('00000000-0000-4000-8000-000000000000', '2026-01-01', 100),
      ).rejects.toThrow(/foreign key|budget_periods_household_id/i);
    });

    it('updateBudget records a change dated the given day', async () => {
      const { space } = await spaceWithBudget();
      const updated = await householdsRepo.updateBudget(handle.db, space.id, 35_000, '2026-01-10');
      expect(updated.monthlyBudgetCents).toBe(35_000);
      expect(await changes(space.id)).toEqual([
        { effectiveFrom: '2026-01-10', budgetCents: 35_000 },
      ]);
    });

    it('an unchanged budget writes nothing', async () => {
      const { space } = await spaceWithBudget(35_000, '2026-01-10');
      const before = await householdsRepo.findById(handle.db, space.id);

      await householdsRepo.updateBudget(handle.db, space.id, 35_000, '2026-01-12');

      expect(await changes(space.id)).toEqual([
        { effectiveFrom: '2026-01-10', budgetCents: 35_000 },
      ]);
      const after = await householdsRepo.findById(handle.db, space.id);
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
    });

    it('several changes on one day keep only the last', async () => {
      const { space } = await spaceWithBudget(35_000, '1970-01-01');
      await householdsRepo.updateBudget(handle.db, space.id, 50_000, '2026-03-05');
      await householdsRepo.updateBudget(handle.db, space.id, 42_000, '2026-03-05');
      await householdsRepo.updateBudget(handle.db, space.id, 50_000, '2026-03-05');

      expect(await changes(space.id)).toEqual([
        { effectiveFrom: '1970-01-01', budgetCents: 35_000 },
        { effectiveFrom: '2026-03-05', budgetCents: 50_000 },
      ]);
    });

    it('removing the budget records a change to no budget', async () => {
      const { space } = await spaceWithBudget(50_000, '1970-01-01');
      const updated = await householdsRepo.updateBudget(handle.db, space.id, null, '2026-06-01');
      expect(updated.monthlyBudgetCents).toBeNull();
      expect(await changes(space.id)).toEqual([
        { effectiveFrom: '1970-01-01', budgetCents: 50_000 },
        { effectiveFrom: '2026-06-01', budgetCents: null },
      ]);
    });

    it('a change from a timezone behind is never dated before the latest change', async () => {
      const { creator, space } = await spaceWithBudget();
      const partner = await makeUser(PARTNER_TELEGRAM_ID);
      const invite = await householdsRepo.createInvite(handle.db, space.id, creator.id);
      await householdsRepo.joinByCode(handle.db, invite.code, partner.id);

      await householdsRepo.updateBudget(handle.db, space.id, 50_000, '2026-11-01'); // SGT, just after midnight
      const updated = await householdsRepo.updateBudget(handle.db, space.id, 60_000, '2026-10-31'); // a member still on the 31st

      expect(await changes(space.id)).toEqual([
        { effectiveFrom: '2026-11-01', budgetCents: 60_000 },
      ]);
      expect(updated.monthlyBudgetCents).toBe(60_000);
    });

    it('a change that waits for a concurrent one re-reads it and is never lost', async () => {
      const { space } = await spaceWithBudget(35_000, '1970-01-01');
      const id = space.id;
      const holder = postgres(TEST_DATABASE_URL as string, {
        max: 1,
        prepare: false,
        onnotice: () => {},
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockedSignal = new Promise<void>((resolve) => (locked = resolve));
      let pending: Promise<unknown> | undefined;
      let holderDone: Promise<unknown> | undefined;
      try {
        // A second connection: a concurrent change, mid-transaction.
        holderDone = holder.begin(async (tx) => {
          await tx`SELECT 1 FROM households WHERE id = ${id} FOR UPDATE`;
          await tx`UPDATE households SET monthly_budget_cents = 50000 WHERE id = ${id}`;
          await tx`INSERT INTO budget_periods (household_id, effective_from, budget_cents)
                   VALUES (${id}, '2026-03-05', 50000)`;
          locked();
          await released;
        });
        await Promise.race([lockedSignal, holderDone]);

        let settled = false;
        pending = householdsRepo.updateBudget(handle.db, id, 35_000, '2026-03-05').finally(() => {
          settled = true;
        });

        // Wait until Postgres says the locking SELECT is blocked on a lock.
        const deadline = Date.now() + 5_000;
        let blocked = false;
        while (!blocked && Date.now() < deadline) {
          const rows = await handle.db.execute(
            sql`SELECT 1 FROM pg_stat_activity
                WHERE datname = current_database()
                  AND wait_event_type = 'Lock'
                  AND query ILIKE '%no key update%'`,
          );
          blocked = rows.length > 0;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        expect(settled).toBe(false);

        release();
        await holderDone;
        await pending;
      } finally {
        release();
        await Promise.allSettled([holderDone, pending]);
        await holder.end();
      }

      const reread = await householdsRepo.findById(handle.db, id);
      expect(reread?.monthlyBudgetCents).toBe(35_000);
      expect(await changes(id)).toEqual([
        { effectiveFrom: '1970-01-01', budgetCents: 35_000 },
        { effectiveFrom: '2026-03-05', budgetCents: 35_000 },
      ]);
    }, 20_000);
  });
});
