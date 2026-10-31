/**
 * Tests for the /settings command (B-004, PRD F9.1 / F9.4 / F13.5).
 *
 * Written before the feature exists: `./settings.js` is not built yet.
 */

import { eq } from 'drizzle-orm';
import { Bot } from 'grammy';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '@spendlygo/core';
import { createDatabase, schema, usersRepo, type DatabaseHandle, type User } from '@spendlygo/db';
import type { Config } from '../../config.js';
import type { AppContext } from '../../context.js';
import { setLogLevel } from '../../logger.js';
import { configureBotMenu } from '../index.js';
import type { BotContext } from '../middleware.js';
import {
  buildSettingsText,
  handleSettingsCallback,
  hourPickerKeyboard,
  parseSettingsCallback,
  settingsKeyboard,
} from './settings.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const TELEGRAM_A = 980000000001n;
const TELEGRAM_B = 980000000002n;
const STALE_TEXT = 'That button is out of date — send /settings again.';

function configWith(overrides: Partial<Config>): Config {
  return {
    nodeEnv: 'production',
    isProduction: true,
    port: 3000,
    botToken: '111111:token',
    webhookSecretToken: 'secret-secret-secret',
    databaseUrl: 'postgresql://localhost/db',
    miniappUrl: 'https://spendlygo-app.onrender.com',
    serverUrl: 'https://spendlygo-api.onrender.com',
    cronSecret: 'cron-cron-cron-cron',
    ocrSpaceApiKey: undefined,
    allowedTelegramIds: new Set<bigint>(),
    defaultTimezone: 'Asia/Singapore',
    autoSetWebhook: true,
    version: 'test',
    ...overrides,
  } satisfies Config;
}

function appContext(overrides: Partial<Config> = {}): AppContext {
  return {
    config: configWith(overrides),
    db: {} as never,
    dbHandle: null as never,
    clock: fixedClock('2026-08-27T04:00:00Z'),
  };
}

function userWith(overrides: Partial<User> = {}): User {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    telegramId: 1n,
    timezone: 'Asia/Singapore',
    digestHour: 21,
    digestEnabled: true,
    nudgeEnabled: true,
    alertsEnabled: false,
    ...overrides,
  } as User;
}

function fakeBotCtx(appUser: User, data: string | undefined): BotContext {
  return {
    appUser,
    callbackQuery: { data },
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as BotContext;
}

type Button = { text: string; callback_data?: string; web_app?: { url: string } };

function rowsOf(keyboard: { inline_keyboard: unknown[][] }): Button[][] {
  return keyboard.inline_keyboard as Button[][];
}

function allButtons(keyboard: { inline_keyboard: unknown[][] }): Button[] {
  return rowsOf(keyboard).flat();
}

function callbackData(keyboard: { inline_keyboard: unknown[][] }): string[] {
  return allButtons(keyboard)
    .map((b) => b.callback_data)
    .filter((d): d is string => d !== undefined);
}

function mock(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>;
}

describe('/settings rendering (PRD F9.4)', () => {
  const config = configWith({});

  it('shows digest state and hour, timezone, nudge and alerts', () => {
    const text = buildSettingsText(userWith(), config);
    expect(text).toContain('Daily digest: *on* at 21:00');
    expect(text).toContain('Asia/Singapore');
    expect(text).toContain('nudge: *on*');
    expect(text).toContain('Budget alerts (80% / 100%): *off*');
  });

  it('pads midnight to 00:00 and escapes the timezone', () => {
    const text = buildSettingsText(
      userWith({ timezone: 'America/Los_Angeles', digestHour: 0 }),
      config,
    );
    expect(text).toContain('00:00');
    expect(text).toContain('Los\\_Angeles');
    expect(text).not.toContain('Los_Angeles');
  });

  it('each toggle button carries the opposite of the current state', () => {
    const user = userWith({ digestEnabled: true, nudgeEnabled: false, alertsEnabled: true });
    const data = callbackData(settingsKeyboard(user, config));
    expect(data).toEqual(['set:d:0', 'set:hp', 'set:n:1', 'set:a:0']);
  });

  it('every callback_data is set:-prefixed and within 64 bytes', () => {
    const keyboards = [hourPickerKeyboard(userWith())];
    for (const digestEnabled of [true, false]) {
      for (const nudgeEnabled of [true, false]) {
        for (const alertsEnabled of [true, false]) {
          keyboards.push(
            settingsKeyboard(userWith({ digestEnabled, nudgeEnabled, alertsEnabled }), config),
          );
        }
      }
    }
    expect(keyboards).toHaveLength(9);
    for (const keyboard of keyboards) {
      const data = callbackData(keyboard);
      expect(data.length).toBeGreaterThan(0);
      for (const value of data) {
        expect(value.startsWith('set:')).toBe(true);
        expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(64);
      }
    }
  });

  it('links to the Mini App over HTTPS', () => {
    const rows = rowsOf(settingsKeyboard(userWith(), config));
    const last = rows[rows.length - 1] ?? [];
    expect(last).toHaveLength(1);
    expect(last[0]?.web_app?.url).toBe(config.miniappUrl);
  });

  it('points to /app when the Mini App cannot launch', () => {
    const local = configWith({ miniappUrl: 'http://localhost:5173' });
    const buttons = allButtons(settingsKeyboard(userWith(), local));
    expect(buttons.some((b) => b.web_app !== undefined)).toBe(false);
    expect(buildSettingsText(userWith(), local)).toContain('/app');
  });

  it('hour picker lists 24 hours in order, marks the current one, and has Back', () => {
    const buttons = allButtons(hourPickerKeyboard(userWith({ digestHour: 21 })));
    const hours = buttons.slice(0, 24);
    expect(buttons).toHaveLength(25);
    expect(hours.map((b) => b.callback_data)).toEqual(
      Array.from({ length: 24 }, (_, h) => `set:h:${h}`),
    );
    const marked = hours.filter((b) => b.text.includes('•'));
    expect(marked).toHaveLength(1);
    expect(marked[0]?.callback_data).toBe('set:h:21');
    expect(buttons[24]?.callback_data).toBe('set:back');
  });

  it('parseSettingsCallback accepts only well-formed data', () => {
    for (const bad of ['set:h:24', 'set:h:-1', 'set:h:7x', 'set:d:2', 'set:zz', 'undo:abc']) {
      expect(parseSettingsCallback(bad), bad).toBeNull();
    }
    expect(parseSettingsCallback(undefined)).toBeNull();
    expect(parseSettingsCallback('set:d:0')).toEqual({
      kind: 'update',
      input: { digestEnabled: false },
    });
    expect(parseSettingsCallback('set:h:7')).toEqual({
      kind: 'update',
      input: { digestHour: 7 },
    });
    expect(parseSettingsCallback('set:hp')).toEqual({ kind: 'view', view: 'hours' });
    expect(parseSettingsCallback('set:back')).toEqual({ kind: 'view', view: 'main' });
  });
});

describe('/settings callbacks without a database', () => {
  it('stale or malformed data is answered without writing', async () => {
    const botCtx = fakeBotCtx(userWith(), 'set:h:99');
    await handleSettingsCallback(appContext(), botCtx);
    expect(botCtx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(botCtx.answerCallbackQuery).toHaveBeenCalledWith({ text: STALE_TEXT });
    expect(botCtx.editMessageText).not.toHaveBeenCalled();
  });

  it('answers the callback even when saving fails', async () => {
    const botCtx = fakeBotCtx(userWith(), 'set:d:0');
    await expect(handleSettingsCallback(appContext(), botCtx)).rejects.toBeDefined();
    expect(botCtx.answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  it('opening the hour picker edits the keyboard without writing', async () => {
    const botCtx = fakeBotCtx(userWith(), 'set:hp');
    await handleSettingsCallback(appContext(), botCtx);
    expect(botCtx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(botCtx.editMessageReplyMarkup).toHaveBeenCalledTimes(1);
    const arg = mock(botCtx.editMessageReplyMarkup).mock.calls[0]?.[0] as {
      reply_markup: { inline_keyboard: unknown[][] };
    };
    expect(callbackData(arg.reply_markup)).toContain('set:h:23');
    expect(callbackData(arg.reply_markup)).toContain('set:back');
  });
});

describe('/settings menu registration', () => {
  it("/settings is in the bot's command menu", async () => {
    const bot = new Bot<BotContext>('111111:token', { botInfo: undefined as never });
    const setMyCommands = vi.fn().mockResolvedValue(true);
    bot.api.setMyCommands = setMyCommands as never;
    bot.api.setChatMenuButton = vi.fn().mockResolvedValue(true) as never;

    await configureBotMenu(bot as never, appContext());

    const commands = setMyCommands.mock.calls[0]?.[0] as { command: string }[];
    expect(commands.map((c) => c.command)).toContain('settings');
  });
});

describeIfDb('/settings callbacks (DB)', () => {
  let handle: DatabaseHandle;
  let userA: User;
  let userB: User;
  const ctx = appContext();

  async function cleanUp(): Promise<void> {
    for (const telegramId of [TELEGRAM_A, TELEGRAM_B]) {
      const rows = await handle.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.telegramId, telegramId));
      for (const row of rows) {
        await handle.db.delete(schema.households).where(eq(schema.households.createdBy, row.id));
      }
      await handle.db.delete(schema.users).where(eq(schema.users.telegramId, telegramId));
    }
  }

  async function reload(user: User): Promise<User> {
    const fresh = await usersRepo.findById(handle.db, user.id);
    if (!fresh) throw new Error('user vanished');
    return fresh;
  }

  beforeAll(() => {
    setLogLevel('error');
    handle = createDatabase(TEST_DATABASE_URL as string, { maxConnections: 2 });
    Object.assign(ctx, { db: handle.db, dbHandle: handle });
  });

  beforeEach(async () => {
    await cleanUp();
    userA = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: TELEGRAM_A,
      timezone: 'Asia/Singapore',
    });
    userB = await usersRepo.upsertByTelegramId(handle.db, {
      telegramId: TELEGRAM_B,
      timezone: 'Asia/Singapore',
    });
    for (const u of [userA, userB]) {
      await usersRepo.updateSettings(handle.db, u.id, {
        digestEnabled: true,
        nudgeEnabled: true,
        alertsEnabled: true,
        digestHour: 21,
      });
    }
    userA = await reload(userA);
    userB = await reload(userB);
  });

  afterAll(async () => {
    await cleanUp();
    await handle.close();
  });

  it('turning the digest off saves, answers and re-renders', async () => {
    const botCtx = fakeBotCtx(userA, 'set:d:0');
    await handleSettingsCallback(ctx, botCtx);

    expect((await reload(userA)).digestEnabled).toBe(false);
    expect(botCtx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(botCtx.editMessageText).toHaveBeenCalledTimes(1);
    const [text, options] = mock(botCtx.editMessageText).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: unknown[][] } },
    ];
    expect(text).toContain('Daily digest: *off*');
    expect(callbackData(options.reply_markup)).toContain('set:d:1');
  });

  it('turning the nudge off changes only nudge_enabled', async () => {
    await handleSettingsCallback(ctx, fakeBotCtx(userA, 'set:n:0'));
    const after = await reload(userA);
    expect(after.nudgeEnabled).toBe(false);
    expect(after.digestEnabled).toBe(userA.digestEnabled);
    expect(after.alertsEnabled).toBe(userA.alertsEnabled);
    expect(after.digestHour).toBe(userA.digestHour);
    expect(after.timezone).toBe(userA.timezone);
  });

  it('turning alerts off leaves the digest on', async () => {
    await handleSettingsCallback(ctx, fakeBotCtx(userA, 'set:a:0'));
    const after = await reload(userA);
    expect(after.alertsEnabled).toBe(false);
    expect(after.digestEnabled).toBe(true);
  });

  it('picking an hour saves it and returns to the main view', async () => {
    const botCtx = fakeBotCtx(userA, 'set:h:7');
    await handleSettingsCallback(ctx, botCtx);

    expect((await reload(userA)).digestHour).toBe(7);
    expect(botCtx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    const [text] = mock(botCtx.editMessageText).mock.calls[0] as [string];
    expect(text).toContain('07:00');
  });

  it('a redelivered callback is idempotent and tolerates "message is not modified"', async () => {
    const first = fakeBotCtx(userA, 'set:d:0');
    await handleSettingsCallback(ctx, first);

    const second = fakeBotCtx(userA, 'set:d:0');
    mock(second.editMessageText).mockRejectedValueOnce(
      new Error('Bad Request: message is not modified'),
    );
    await expect(handleSettingsCallback(ctx, second)).resolves.toBeUndefined();

    expect((await reload(userA)).digestEnabled).toBe(false);
    expect(first.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(second.answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  it("a callback only changes the sender's own settings", async () => {
    await handleSettingsCallback(ctx, fakeBotCtx(userB, 'set:d:0'));
    expect((await reload(userB)).digestEnabled).toBe(false);
    expect((await reload(userA)).digestEnabled).toBe(true);
  });
});
