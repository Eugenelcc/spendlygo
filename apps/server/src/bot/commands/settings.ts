/**
 * /settings — digest time and notification toggles from chat (PRD F9.1, F9.4,
 * F13.5). Timezone is shown read-only.
 *
 * Callback data (absolute target values, so a replay is a no-op):
 *   set:d:0|1  digest   set:n:0|1  nudge   set:a:0|1  alerts
 *   set:h:<0..23>  digest hour   set:hp  hour picker   set:back  main view
 */

import { InlineKeyboard } from 'grammy';
import { usersRepo, type User } from '@spendlygo/db';
import { updateSettingsSchema } from '@spendlygo/shared';
import type { Config } from '../../config.js';
import type { AppContext } from '../../context.js';
import { logger } from '../../logger.js';
import { canLaunchMiniApp } from '../keyboards.js';
import { escapeMarkdown } from '../markdown.js';
import type { BotContext } from '../middleware.js';

export const SETTINGS_PREFIX = 'set:';

const STALE_TEXT = 'That button is out of date — send /settings again.';

export type SettingsAction =
  | { kind: 'update'; input: usersRepo.UpdateSettingsInput }
  | { kind: 'view'; view: 'main' | 'hours' };

function formatHour24(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function parseSettingsCallback(data: string | undefined): SettingsAction | null {
  if (data === undefined) return null;
  if (data === 'set:hp') return { kind: 'view', view: 'hours' };
  if (data === 'set:back') return { kind: 'view', view: 'main' };

  let input: usersRepo.UpdateSettingsInput;
  const toggle = /^set:(d|n|a):([01])$/.exec(data);
  const hour = /^set:h:(\d{1,2})$/.exec(data);
  if (toggle) {
    const value = toggle[2] === '1';
    if (toggle[1] === 'd') input = { digestEnabled: value };
    else if (toggle[1] === 'n') input = { nudgeEnabled: value };
    else input = { alertsEnabled: value };
  } else if (hour) {
    input = { digestHour: Number(hour[1]) };
  } else {
    return null;
  }

  if (!updateSettingsSchema.safeParse(input).success) return null;
  return { kind: 'update', input };
}

export function buildSettingsText(user: User, config: Config): string {
  const onOff = (value: boolean): string => (value ? '*on*' : '*off*');
  const timezone = escapeMarkdown(user.timezone);
  const nudge = `"Nothing logged" nudge: ${onOff(user.nudgeEnabled)}`;
  return [
    '*Settings*',
    '',
    `Daily digest: ${onOff(user.digestEnabled)} at ${formatHour24(user.digestHour)} (${timezone})`,
    user.digestEnabled ? nudge : `${nudge} _(only sent with the digest)_`,
    `Budget alerts (80% / 100%): ${onOff(user.alertsEnabled)}`,
    `Timezone: ${timezone}`,
    '',
    canLaunchMiniApp(config)
      ? 'Budget, categories and the rest are in the app.'
      : 'Budget, categories and the rest are in the app — /app.',
  ].join('\n');
}

export function settingsKeyboard(user: User, config: Config): InlineKeyboard {
  const bit = (value: boolean): string => (value ? '1' : '0');
  const label = (on: boolean, what: string): string => `Turn ${what} ${on ? 'off' : 'on'}`;
  const keyboard = new InlineKeyboard()
    .text(label(user.digestEnabled, 'digest'), `set:d:${bit(!user.digestEnabled)}`)
    .row()
    .text('Change digest time', 'set:hp')
    .row()
    .text(label(user.nudgeEnabled, 'nudge'), `set:n:${bit(!user.nudgeEnabled)}`)
    .row()
    .text(label(user.alertsEnabled, 'alerts'), `set:a:${bit(!user.alertsEnabled)}`);
  if (canLaunchMiniApp(config)) {
    keyboard.row().webApp('⚙️ More in the app', config.miniappUrl);
  }
  return keyboard;
}

export function hourPickerKeyboard(user: User): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let hour = 0; hour < 24; hour++) {
    const text = `${hour === user.digestHour ? '• ' : ''}${formatHour24(hour)}`;
    keyboard.text(text, `set:h:${hour}`);
    if (hour % 4 === 3) keyboard.row();
  }
  return keyboard.text('← Back', 'set:back');
}

export async function handleSettings(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  await botCtx.reply(buildSettingsText(user, ctx.config), {
    parse_mode: 'Markdown',
    reply_markup: settingsKeyboard(user, ctx.config),
  });
}

export async function handleSettingsCallback(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const action = parseSettingsCallback(botCtx.callbackQuery?.data);
  if (!action) {
    await botCtx.answerCallbackQuery({ text: STALE_TEXT });
    return;
  }

  if (action.kind === 'view') {
    await botCtx.answerCallbackQuery();
    const user = botCtx.appUser;
    await botCtx
      .editMessageReplyMarkup({
        reply_markup:
          action.view === 'hours' ? hourPickerKeyboard(user) : settingsKeyboard(user, ctx.config),
      })
      .catch(() => {});
    return;
  }

  let updated: User;
  try {
    updated = await usersRepo.updateSettings(ctx.db, botCtx.appUser.id, action.input);
  } catch (error) {
    await botCtx.answerCallbackQuery({ text: "Couldn't save that — try again." }).catch(() => {});
    throw error;
  }

  await botCtx.answerCallbackQuery({ text: 'Saved' });
  // "message is not modified" on a replayed button is expected; swallow it.
  await botCtx
    .editMessageText(buildSettingsText(updated, ctx.config), {
      parse_mode: 'Markdown',
      reply_markup: settingsKeyboard(updated, ctx.config),
    })
    .catch(() => {});

  logger.info('settings.updated', {
    userId: botCtx.appUser.id,
    fields: Object.keys(action.input).join(','),
  });
}
