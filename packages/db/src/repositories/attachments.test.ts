/**
 * Integration tests for attachment visibility.
 *
 * Mirrors transactions.household.test.ts's asymmetry, applied to photos: a
 * stranger never sees one, a household partner sees one on a shared
 * transaction exactly as they'd see the transaction itself — the whole point
 * of a shared budget being transparent, not just combined.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, schema, usersRepo, type DatabaseHandle } from '../index.js';
import * as attachmentsRepo from './attachments.js';
import * as householdsRepo from './households.js';
import * as transactionsRepo from './transactions.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const OWNER_TELEGRAM_ID = 960000000001n;
const PARTNER_TELEGRAM_ID = 960000000002n;
const STRANGER_TELEGRAM_ID = 960000000003n;

describeIfDb('attachment visibility', () => {
  let handle: DatabaseHandle;
  let ownerId: string;
  let partnerId: string;
  let strangerId: string;
  let soloTransactionId: string;
  let sharedTransactionId: string;
  let soloAttachmentId: string;
  let sharedAttachmentId: string;

  beforeAll(async () => {
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 3 });
  });

  async function cleanUp(): Promise<void> {
    for (const id of [OWNER_TELEGRAM_ID, PARTNER_TELEGRAM_ID, STRANGER_TELEGRAM_ID]) {
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

    const owner = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: OWNER_TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
    ownerId = owner.id;

    const stranger = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: STRANGER_TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
    strangerId = stranger.id;

    const household = await householdsRepo.create(handle.db, ownerId);
    const partner = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: PARTNER_TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
    const invite = await householdsRepo.createInvite(handle.db, household.id, ownerId);
    await householdsRepo.joinByCode(handle.db, invite.code, partner.id);
    partnerId = partner.id;

    const solo = await transactionsRepo.create(handle.db, {
      userId: ownerId,
      householdId: null,
      direction: 'out',
      amountCents: 1200,
      categoryId: null,
      note: 'solo lunch',
      occurredOn: '2026-08-20',
      source: 'chat',
    });
    soloTransactionId = solo.id;

    const shared = await transactionsRepo.create(handle.db, {
      userId: ownerId,
      householdId: household.id,
      direction: 'out',
      amountCents: 4500,
      categoryId: null,
      note: 'shared groceries',
      occurredOn: '2026-08-21',
      source: 'chat',
    });
    sharedTransactionId = shared.id;

    const soloAttachment = await attachmentsRepo.create(handle.db, {
      transactionId: soloTransactionId,
      userId: ownerId,
      tgFileId: 'file-solo',
      tgFileUniqueId: 'unique-solo',
      width: 800,
      height: 600,
      fileSize: 12_345,
    });
    soloAttachmentId = soloAttachment.id;

    const sharedAttachment = await attachmentsRepo.create(handle.db, {
      transactionId: sharedTransactionId,
      userId: ownerId,
      tgFileId: 'file-shared',
      tgFileUniqueId: 'unique-shared',
      width: 800,
      height: 600,
      fileSize: 23_456,
    });
    sharedAttachmentId = sharedAttachment.id;
  });

  afterAll(async () => {
    await cleanUp();
    await handle.close();
  });

  describe('findViewable', () => {
    it('the owner sees their own attachment on a solo transaction', async () => {
      const found = await attachmentsRepo.findViewable(handle.db, ownerId, null, soloAttachmentId);
      expect(found?.id).toBe(soloAttachmentId);
    });

    it('a stranger never sees a solo attachment', async () => {
      const found = await attachmentsRepo.findViewable(
        handle.db,
        strangerId,
        null,
        soloAttachmentId,
      );
      expect(found).toBeNull();
    });

    it('a household partner sees a photo on a shared transaction — full transparency', async () => {
      const partnerHousehold =
        (await usersRepo.findById(handle.db, partnerId))?.householdId ?? null;
      const found = await attachmentsRepo.findViewable(
        handle.db,
        partnerId,
        partnerHousehold,
        sharedAttachmentId,
      );
      expect(found?.id).toBe(sharedAttachmentId);
    });

    it("a household partner still cannot see the owner's SOLO attachment", async () => {
      const partnerHousehold =
        (await usersRepo.findById(handle.db, partnerId))?.householdId ?? null;
      const found = await attachmentsRepo.findViewable(
        handle.db,
        partnerId,
        partnerHousehold,
        soloAttachmentId,
      );
      expect(found).toBeNull();
    });

    it('a stranger never sees a shared-household attachment either', async () => {
      const found = await attachmentsRepo.findViewable(
        handle.db,
        strangerId,
        null,
        sharedAttachmentId,
      );
      expect(found).toBeNull();
    });

    it('returns null for a nonexistent id, same shape as "not yours"', async () => {
      const found = await attachmentsRepo.findViewable(
        handle.db,
        ownerId,
        null,
        '00000000-0000-0000-0000-000000000000',
      );
      expect(found).toBeNull();
    });
  });

  describe('listForTransaction', () => {
    it('lists every visible attachment on a transaction', async () => {
      const rows = await attachmentsRepo.listForTransaction(
        handle.db,
        ownerId,
        null,
        soloTransactionId,
      );
      expect(rows.map((r) => r.id)).toEqual([soloAttachmentId]);
    });

    it('is empty for a transaction the viewer cannot see', async () => {
      const rows = await attachmentsRepo.listForTransaction(
        handle.db,
        strangerId,
        null,
        soloTransactionId,
      );
      expect(rows).toHaveLength(0);
    });
  });
});
