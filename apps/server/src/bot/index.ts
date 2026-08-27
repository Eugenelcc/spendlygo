/**
 * The Telegram bot.
 *
 * GUARDRAILS.md section 7: webhooks only, never polling — polling burns CPU
 * continuously and would keep the free instance permanently busy.
 */

import { Bot } from 'grammy';
import type { AppContext } from '../context.js';
import { describeError, logger } from '../logger.js';
import { handleHelp } from './commands/help.js';
import { handleStart } from './commands/start.js';
import { canLaunchMiniApp, openAppKeyboard } from './keyboards.js';
import { allowlist, timing, withUser, type BotContext } from './middleware.js';

export type SpendlygoBot = Bot<BotContext>;

export function createBot(ctx: AppContext): SpendlygoBot {
  const bot = new Bot<BotContext>(ctx.config.botToken);

  bot.use(timing);
  bot.use(allowlist(ctx));
  bot.use(withUser(ctx));

  bot.command('start', (botCtx) => handleStart(ctx, botCtx));
  bot.command('help', (botCtx) => handleHelp(ctx, botCtx));

  bot.command('app', async (botCtx) => {
    const keyboard = openAppKeyboard(ctx.config);
    if (!keyboard) {
      await botCtx.reply('The Mini App is not available in this environment.');
      return;
    }
    await botCtx.reply('Here you go:', { reply_markup: keyboard });
  });

  // Any other slash command. Capture (PRD F1) lands in P1; until then, say so
  // plainly rather than pretending to understand.
  bot.on('message:text', async (botCtx) => {
    const text = botCtx.message.text.trim();
    if (text.startsWith('/')) {
      await botCtx.reply("I don't know that command yet. Try /help.");
      return;
    }
    await botCtx.reply(
      "I can't log spending yet — quick-text capture is the next thing being built.\n" +
        'Try /help to see what is coming.',
    );
  });

  bot.catch((error) => {
    // Never surface an internal error to the user, and never log the message
    // body (GUARDRAILS.md section 6).
    logger.error('bot.error', {
      telegramId: error.ctx.from?.id,
      ...describeError(error.error),
    });
  });

  return bot;
}

/**
 * One-time setup of the command menu and the chat menu button.
 *
 * Idempotent, so it is safe to run on every boot — and a boot is the only time
 * we can be sure the deployed code and the menu agree.
 */
export async function configureBotMenu(bot: SpendlygoBot, ctx: AppContext): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Get started' },
    { command: 'app', description: 'Open Spendlygo' },
    { command: 'help', description: 'How to log a spend' },
  ]);

  if (canLaunchMiniApp(ctx.config)) {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: 'Spendlygo',
        web_app: { url: ctx.config.miniappUrl },
      },
    });
  }
}
