/**
 * Integration tests for who-owes-who (PRD-adjacent): split expenses and
 * GET /api/household/balances.
 *
 * GUARDRAILS.md section 13: every route gets unauthenticated AND cross-user
 * isolation coverage. The isolation case that matters most here is a
 * stranger never seeing another household's balances or splits.
 */

import { createHmac } from 'node:crypto';
import { Bot } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { fixedClock } from '@spendlygo/core';
import {
  createDatabase,
  householdsRepo,
  schema,
  usersRepo,
  type DatabaseHandle,
} from '@spendlygo/db';
import {
  householdBalancesResponseSchema,
  transactionSplitsResponseSchema,
} from '@spendlygo/shared';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';
import { setLogLevel } from '../logger.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const BOT_TOKEN = '111111:AAH-test-token-for-integration-tests';
const NOW = new Date('2026-08-27T04:00:00Z');

const OWNER = 990200000001n;
const PARTNER = 990200000002n;
const STRANGER = 990200000003n;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(response: Response): Promise<any> {
  return response.json();
}

function auth(telegramId: bigint): Record<string, string> {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 30),
    user: JSON.stringify({ id: Number(telegramId), first_name: 'Test' }),
  };
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return { Authorization: `tma ${params.toString()}`, 'Content-Type': 'application/json' };
}

describeIfDb('who-owes-who (splits + balances)', () => {
  let handle: DatabaseHandle;
  let app: ReturnType<typeof createApp>;

  const config: Config = {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    botToken: BOT_TOKEN,
    webhookSecretToken: 'secret-token-for-tests',
    databaseUrl: TEST_DATABASE_URL ?? '',
    miniappUrl: 'https://app.example.test',
    serverUrl: undefined,
    cronSecret: 'cron-secret-for-tests-000',
    ocrSpaceApiKey: undefined,
    allowedTelegramIds: new Set<bigint>(),
    defaultTimezone: 'Asia/Singapore',
    autoSetWebhook: false,
    version: 'test',
  };

  const cleanUsers = async () => {
    const rows = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.telegramId, [OWNER, PARTNER, STRANGER]));

    // Every transaction across all three test users first — a shared
    // household can hold a partner's transactions too, and deleting the
    // household while those still exist violates its FK (transaction_splits
    // cascades automatically from transactions, see schema.ts).
    for (const row of rows) {
      await handle.db.delete(schema.transactions).where(eq(schema.transactions.userId, row.id));
    }
    for (const row of rows) {
      await handle.db.delete(schema.households).where(eq(schema.households.createdBy, row.id));
    }
    for (const id of [OWNER, PARTNER, STRANGER]) {
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, id));
    }
  };

  beforeAll(async () => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    const ctx: AppContext = { config, db: handle.db, dbHandle: handle, clock: fixedClock(NOW) };
    app = createApp(ctx, new Bot(BOT_TOKEN, { botInfo: undefined as never }), {
      state: { bot: 'ready', webhook: 'registered' },
    });
  });

  beforeEach(cleanUsers);
  afterAll(async () => {
    await cleanUsers();
    await handle.close();
  });

  /** OWNER invites, PARTNER joins — both land active in the same shared space. */
  async function sharedHousehold(): Promise<{ ownerId: string; partnerId: string }> {
    const invite = await json(
      await app.request('/api/household/invite', { method: 'POST', headers: auth(OWNER) }),
    );
    const owner = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: OWNER,
      timezone: 'Asia/Singapore',
    });
    const partner = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: PARTNER,
      timezone: 'Asia/Singapore',
    });
    await householdsRepo.joinByCode(handle.db, invite.code, partner.id);
    return { ownerId: owner.id, partnerId: partner.id };
  }

  describe('POST /api/transactions with splits', () => {
    it('creates a split expense and marks it hasSplit', async () => {
      const { ownerId, partnerId } = await sharedHousehold();

      const created = await json(
        await app.request('/api/transactions', {
          method: 'POST',
          headers: auth(OWNER),
          body: JSON.stringify({
            direction: 'out',
            amountCents: 10_000,
            splits: [
              { userId: ownerId, shareCents: 5_000 },
              { userId: partnerId, shareCents: 5_000 },
            ],
          }),
        }),
      );
      expect(created.transaction.hasSplit).toBe(true);

      const splits = transactionSplitsResponseSchema.parse(
        await json(
          await app.request(`/api/transactions/${created.transaction.id}/splits`, {
            headers: auth(OWNER),
          }),
        ),
      );
      expect(splits.splits).toHaveLength(2);
      expect(splits.splits.map((s) => s.shareCents).sort()).toEqual([5_000, 5_000]);
    });

    it("rejects a split that doesn't add up to the full amount", async () => {
      const { ownerId, partnerId } = await sharedHousehold();

      const response = await app.request('/api/transactions', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({
          direction: 'out',
          amountCents: 10_000,
          splits: [
            { userId: ownerId, shareCents: 4_000 },
            { userId: partnerId, shareCents: 5_000 },
          ],
        }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects splitting an income entry', async () => {
      const { ownerId } = await sharedHousehold();

      const response = await app.request('/api/transactions', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({
          direction: 'in',
          amountCents: 10_000,
          splits: [{ userId: ownerId, shareCents: 10_000 }],
        }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects splitting in a personal (not shared) space', async () => {
      const owner = await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: OWNER,
        timezone: 'Asia/Singapore',
      });

      const response = await app.request('/api/transactions', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({
          direction: 'out',
          amountCents: 10_000,
          splits: [{ userId: owner.id, shareCents: 10_000 }],
        }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects a split naming someone outside the household', async () => {
      const { ownerId } = await sharedHousehold();
      const stranger = await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: STRANGER,
        timezone: 'Asia/Singapore',
      });

      const response = await app.request('/api/transactions', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({
          direction: 'out',
          amountCents: 10_000,
          splits: [
            { userId: ownerId, shareCents: 5_000 },
            { userId: stranger.id, shareCents: 5_000 },
          ],
        }),
      });
      expect(response.status).toBe(400);
    });

    it("never leaks a split's shares to someone outside the household", async () => {
      const { ownerId, partnerId } = await sharedHousehold();
      const created = await json(
        await app.request('/api/transactions', {
          method: 'POST',
          headers: auth(OWNER),
          body: JSON.stringify({
            direction: 'out',
            amountCents: 10_000,
            splits: [
              { userId: ownerId, shareCents: 5_000 },
              { userId: partnerId, shareCents: 5_000 },
            ],
          }),
        }),
      );

      await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: STRANGER,
        timezone: 'Asia/Singapore',
      });
      const body = await json(
        await app.request(`/api/transactions/${created.transaction.id}/splits`, {
          headers: auth(STRANGER),
        }),
      );
      expect(body.splits).toHaveLength(0);
    });
  });

  describe('GET /api/household/balances', () => {
    it('is empty for a personal space', async () => {
      await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: OWNER,
        timezone: 'Asia/Singapore',
      });
      const body = householdBalancesResponseSchema.parse(
        await json(await app.request('/api/household/balances', { headers: auth(OWNER) })),
      );
      expect(body.balances).toEqual([]);
      expect(body.settlements).toEqual([]);
    });

    it('settles a single 50/50 split with one transfer', async () => {
      const { ownerId, partnerId } = await sharedHousehold();

      await app.request('/api/transactions', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({
          direction: 'out',
          amountCents: 10_000,
          splits: [
            { userId: ownerId, shareCents: 5_000 },
            { userId: partnerId, shareCents: 5_000 },
          ],
        }),
      });

      const body = householdBalancesResponseSchema.parse(
        await json(await app.request('/api/household/balances', { headers: auth(OWNER) })),
      );
      expect(body.settlements).toHaveLength(1);
      expect(body.settlements[0]).toMatchObject({
        fromUserId: partnerId,
        toUserId: ownerId,
        amountCents: 5_000,
      });

      // Both sides of the same household see the identical debt.
      const fromPartner = householdBalancesResponseSchema.parse(
        await json(await app.request('/api/household/balances', { headers: auth(PARTNER) })),
      );
      expect(fromPartner.settlements).toHaveLength(1);
      expect(fromPartner.settlements[0]).toMatchObject({
        fromUserId: partnerId,
        toUserId: ownerId,
        amountCents: 5_000,
      });
    });

    it('nets several split expenses into one running balance', async () => {
      const { ownerId, partnerId } = await sharedHousehold();

      // Owner pays $100, split evenly (partner owes $50)...
      await app.request('/api/transactions', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({
          direction: 'out',
          amountCents: 10_000,
          splits: [
            { userId: ownerId, shareCents: 5_000 },
            { userId: partnerId, shareCents: 5_000 },
          ],
        }),
      });
      // ...then partner pays $30, split evenly (owner owes $15) — net, partner
      // still owes owner $35, not two separate debts.
      await app.request('/api/transactions', {
        method: 'POST',
        headers: auth(PARTNER),
        body: JSON.stringify({
          direction: 'out',
          amountCents: 3_000,
          splits: [
            { userId: ownerId, shareCents: 1_500 },
            { userId: partnerId, shareCents: 1_500 },
          ],
        }),
      });

      const body = householdBalancesResponseSchema.parse(
        await json(await app.request('/api/household/balances', { headers: auth(OWNER) })),
      );
      expect(body.settlements).toHaveLength(1);
      expect(body.settlements[0]).toMatchObject({
        fromUserId: partnerId,
        toUserId: ownerId,
        amountCents: 3_500,
      });
    });

    it("never includes an unsplit transaction in anyone's balance", async () => {
      const { ownerId } = await sharedHousehold();

      // Logged in the shared space but never split — stays wholly the owner's own.
      await app.request('/api/transactions', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({ direction: 'out', amountCents: 10_000 }),
      });

      const body = householdBalancesResponseSchema.parse(
        await json(await app.request('/api/household/balances', { headers: auth(OWNER) })),
      );
      expect(body.settlements).toEqual([]);
      expect(body.balances.find((b) => b.userId === ownerId)?.netCents).toBe(0);
    });

    it('rejects an unauthenticated request', async () => {
      const response = await app.request('/api/household/balances');
      expect(response.status).toBe(401);
    });

    it("never reflects another household's balances", async () => {
      const { ownerId, partnerId } = await sharedHousehold();
      await app.request('/api/transactions', {
        method: 'POST',
        headers: auth(OWNER),
        body: JSON.stringify({
          direction: 'out',
          amountCents: 10_000,
          splits: [
            { userId: ownerId, shareCents: 5_000 },
            { userId: partnerId, shareCents: 5_000 },
          ],
        }),
      });

      await usersRepo.upsertByTelegramId(handle.db, {
        telegramId: STRANGER,
        timezone: 'Asia/Singapore',
      });
      const body = householdBalancesResponseSchema.parse(
        await json(await app.request('/api/household/balances', { headers: auth(STRANGER) })),
      );
      expect(body.balances).toEqual([]);
      expect(body.settlements).toEqual([]);
    });
  });
});
