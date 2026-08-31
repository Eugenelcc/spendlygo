/**
 * Integration tests for the household-aware transaction scoping.
 *
 * This is the asymmetry described at the top of transactions.ts: `list`
 * (personal/History) keeps a creator's pre-household history visible to
 * them alone, while the aggregates (`totalsForPeriod` and friends, which
 * drive safe-to-spend and Stats) are strictly household-scoped so both
 * partners compute the identical shared number. These tests exist because
 * that distinction is exactly the kind of thing an "obvious" refactor could
 * accidentally collapse back into one filter.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, schema, usersRepo, type DatabaseHandle } from '../index.js';
import * as householdsRepo from './households.js';
import * as transactionsRepo from './transactions.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const CREATOR_TELEGRAM_ID = 970000000001n;
const PARTNER_TELEGRAM_ID = 970000000002n;

describeIfDb('household-aware transaction scoping', () => {
  let handle: DatabaseHandle;
  let creatorId: string;
  let partnerId: string;
  let householdId: string;

  beforeAll(async () => {
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 3 });
  });

  async function cleanUp(): Promise<void> {
    for (const id of [CREATOR_TELEGRAM_ID, PARTNER_TELEGRAM_ID]) {
      const rows = await handle.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.telegramId, id));
      for (const row of rows) {
        await handle.db.delete(schema.households).where(eq(schema.households.createdBy, row.id));
      }
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, id));
    }
  }

  beforeEach(async () => {
    await cleanUp();

    const creator = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: CREATOR_TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
    creatorId = creator.id;

    // The creator logs something SOLO, before any household exists.
    await transactionsRepo.create(handle.db, {
      userId: creatorId,
      householdId: null,
      direction: 'out',
      amountCents: 5000,
      categoryId: null,
      note: 'pre-household grocery run',
      occurredOn: '2026-08-01',
      source: 'chat',
    });

    const household = await householdsRepo.create(handle.db, creatorId);
    householdId = household.id;

    const partner = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: PARTNER_TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
    const invite = await householdsRepo.createInvite(handle.db, householdId, creatorId);
    await householdsRepo.joinByCode(handle.db, invite.code, partner.id);
    partnerId = partner.id;

    // Both partners log something AFTER the household exists.
    await transactionsRepo.create(handle.db, {
      userId: creatorId,
      householdId,
      direction: 'out',
      amountCents: 3000,
      categoryId: null,
      note: 'creator shared spend',
      occurredOn: '2026-08-15',
      source: 'chat',
    });
    await transactionsRepo.create(handle.db, {
      userId: partnerId,
      householdId,
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

  describe('list (personal/History) — the union filter', () => {
    it("keeps the creator's own pre-household history visible to them", async () => {
      const rows = await transactionsRepo.list(handle.db, creatorId, householdId, { limit: 10 });
      const notes = rows.map((r) => r.note);
      expect(notes).toContain('pre-household grocery run');
      expect(notes).toContain('creator shared spend');
      expect(notes).toContain('partner shared spend');
    });

    it("does not leak the creator's pre-household history to the partner", async () => {
      const rows = await transactionsRepo.list(handle.db, partnerId, householdId, { limit: 10 });
      const notes = rows.map((r) => r.note);
      expect(notes).not.toContain('pre-household grocery run');
      expect(notes).toContain('creator shared spend');
      expect(notes).toContain('partner shared spend');
    });

    it('shows the author on every row, so the Mini App can label whose entry it is', async () => {
      const rows = await transactionsRepo.list(handle.db, partnerId, householdId, { limit: 10 });
      const shared = rows.find((r) => r.note === 'creator shared spend');
      expect(shared?.userId).toBe(creatorId);
    });
  });

  describe('totalsForPeriod (safe-to-spend / Stats) — the strict filter', () => {
    it('excludes pre-household spending from the shared total', async () => {
      const totals = await transactionsRepo.totalsForPeriod(
        handle.db,
        creatorId,
        householdId,
        '2026-08-01',
        '2026-08-31',
      );
      // 3000 + 2000 shared, NOT +5000 pre-household.
      expect(totals.outCents).toBe(5000);
    });

    it('computes the identical total for both partners — the whole point', async () => {
      const creatorView = await transactionsRepo.totalsForPeriod(
        handle.db,
        creatorId,
        householdId,
        '2026-08-01',
        '2026-08-31',
      );
      const partnerView = await transactionsRepo.totalsForPeriod(
        handle.db,
        partnerId,
        householdId,
        '2026-08-01',
        '2026-08-31',
      );
      expect(creatorView.outCents).toBe(partnerView.outCents);
      expect(creatorView.budgetedOutCents).toBe(partnerView.budgetedOutCents);
    });

    it('includes both partners spending, not just the caller', async () => {
      const totals = await transactionsRepo.totalsForPeriod(
        handle.db,
        partnerId,
        householdId,
        '2026-08-01',
        '2026-08-31',
      );
      expect(totals.outCents).toBe(5000); // 3000 creator + 2000 partner
      expect(totals.count).toBe(2);
    });
  });

  describe('after leaving a household', () => {
    it('the leaver falls back to seeing only their own transactions', async () => {
      await householdsRepo.leave(handle.db, creatorId);

      const rows = await transactionsRepo.list(handle.db, creatorId, null, { limit: 10 });
      const notes = rows.map((r) => r.note);
      // Everything the CREATOR logged, household-era included — it's still
      // theirs — but not the partner's.
      expect(notes).toContain('pre-household grocery run');
      expect(notes).toContain('creator shared spend');
      expect(notes).not.toContain('partner shared spend');
    });

    it("a leaver's totals revert to solo, not household-wide", async () => {
      await householdsRepo.leave(handle.db, creatorId);

      const totals = await transactionsRepo.totalsForPeriod(
        handle.db,
        creatorId,
        null,
        '2026-08-01',
        '2026-08-31',
      );
      // Solo scope now: 5000 pre-household + 3000 their own shared-era entry.
      // The partner's 2000 is no longer theirs to sum.
      expect(totals.outCents).toBe(8000);
    });
  });
});
