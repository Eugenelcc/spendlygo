import { usersRepo } from '@spendlygo/db';
import { isoDateOf } from '@spendlygo/core';
import type { AppContext } from '../../context.js';
import { canLaunchMiniApp, openAppKeyboard } from '../keyboards.js';
import type { BotContext } from '../middleware.js';

export async function handleStart(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const isReturning = user.onboardedAt !== null;
  const name = user.firstName ?? 'there';
  const today = isoDateOf(ctx.clock.now(), user.timezone);

  if (isReturning) {
    await botCtx.reply(`Welcome back, ${name}. Today is ${today}.`, {
      reply_markup: openAppKeyboard(ctx.config),
    });
    return;
  }

  const lines = [
    `Hi ${name} — I'm Spendlygo. 👋`,
    '',
    'Log a spend by typing the amount and what it was for:',
    '',
    '  `12.50 lunch`',
    '  `+3000 salary`',
    '  `45 dinner @yesterday`',
    '',
    `Your timezone is set to *${user.timezone}* and amounts are in *${user.currency}*.`,
    '',
    "Once you set a monthly budget I'll tell you how much you can safely spend " +
      'each day — one honest number that updates as you go.',
  ];

  if (!canLaunchMiniApp(ctx.config)) {
    lines.push('', '_The Mini App needs an HTTPS URL, so it is unavailable in this environment._');
  }

  await botCtx.reply(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(ctx.config),
  });

  await usersRepo.markOnboarded(ctx.db, user.id);
}
