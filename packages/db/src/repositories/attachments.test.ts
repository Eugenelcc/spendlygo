/**
 * Integration tests for attachment visibility.
 *
 * Mirrors transactions.household.test.ts, applied to photos: a stranger never
 * sees one, a space-mate sees one on a shared transaction exactly as they'd
 * see the transaction itself — the whole point of a shared budget being
 * transparent, not just combined.
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
  let ownerPersonalId: string;
  let sharedId: string;
  let personalTransactionId: string;
  let sharedTransactionId: string;
  let personalAttachmentId: string;
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
        await handle.db.delete(schema.transactions).where(eq(schema.transactions.userId, row.id));
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
    ownerPersonalId = (await householdsRepo.personalSpaceOf(handle.db, ownerId)).id;

    const stranger = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: STRANGER_TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });

    const household = await householdsRepo.create(handle.db, ownerId);
    sharedId = household.id;
    const partner = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: PARTNER_TELEGRAM_ID,
      timezone: 'Asia/Singapore',
    });
    const invite = await householdsRepo.createInvite(handle.db, household.id, ownerId);
    await householdsRepo.joinByCode(handle.db, invite.code, partner.id);

    const personal = await transactionsRepo.create(handle.db, {
      userId: ownerId,
      householdId: ownerPersonalId,
      direction: 'out',
      amountCents: 1200,
      categoryId: null,
      note: 'personal lunch',
      occurredOn: '2026-08-20',
      source: 'chat',
    });
    personalTransactionId = personal.id;

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

    const personalAttachment = await attachmentsRepo.create(handle.db, {
      transactionId: personalTransactionId,
      userId: ownerId,
      tgFileId: 'file-personal',
      tgFileUniqueId: 'unique-personal',
      width: 800,
      height: 600,
      fileSize: 12_345,
    });
    personalAttachmentId = personalAttachment.id;

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

    void stranger; // referenced only for its telegram id above
  });

  afterAll(async () => {
    await cleanUp();
    await handle.close();
  });

  describe('findViewable', () => {
    it('the owner sees their own attachment on a personal-space transaction', async () => {
      const found = await attachmentsRepo.findViewable(
        handle.db,
        ownerPersonalId,
        personalAttachmentId,
      );
      expect(found?.id).toBe(personalAttachmentId);
    });

    it("a stranger's personal space never sees the owner's personal attachment", async () => {
      const stranger = (await usersRepo.findByTelegramId(handle.db, STRANGER_TELEGRAM_ID))!;
      const found = await attachmentsRepo.findViewable(
        handle.db,
        stranger.activeHouseholdId!,
        personalAttachmentId,
      );
      expect(found).toBeNull();
    });

    it('a space-mate sees a photo on a shared transaction — full transparency', async () => {
      const found = await attachmentsRepo.findViewable(handle.db, sharedId, sharedAttachmentId);
      expect(found?.id).toBe(sharedAttachmentId);
    });

    it("a shared space never shows the owner's PERSONAL attachment", async () => {
      const found = await attachmentsRepo.findViewable(handle.db, sharedId, personalAttachmentId);
      expect(found).toBeNull();
    });

    it("a stranger's space never sees a shared attachment either", async () => {
      const stranger = (await usersRepo.findByTelegramId(handle.db, STRANGER_TELEGRAM_ID))!;
      const found = await attachmentsRepo.findViewable(
        handle.db,
        stranger.activeHouseholdId!,
        sharedAttachmentId,
      );
      expect(found).toBeNull();
    });

    it('returns null for a nonexistent id, same shape as "not yours"', async () => {
      const found = await attachmentsRepo.findViewable(
        handle.db,
        ownerPersonalId,
        '00000000-0000-0000-0000-000000000000',
      );
      expect(found).toBeNull();
    });
  });

  describe('listForTransaction', () => {
    it('lists every visible attachment on a transaction', async () => {
      const rows = await attachmentsRepo.listForTransaction(
        handle.db,
        ownerPersonalId,
        personalTransactionId,
      );
      expect(rows.map((r) => r.id)).toEqual([personalAttachmentId]);
    });

    it('is empty for a transaction the viewer cannot see', async () => {
      const stranger = (await usersRepo.findByTelegramId(handle.db, STRANGER_TELEGRAM_ID))!;
      const rows = await attachmentsRepo.listForTransaction(
        handle.db,
        stranger.activeHouseholdId!,
        personalTransactionId,
      );
      expect(rows).toHaveLength(0);
    });
  });
});
