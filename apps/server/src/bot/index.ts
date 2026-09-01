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
import { handleBudget, handleRecent, handleToday, handleUndoCommand } from './commands/money.js';
import { handleRecurring } from './commands/recurring.js';
import { handleHousehold, handleJoin } from './commands/household.js';
import { handleSwitch } from './commands/switch.js';
import { handleGoals } from './commands/goals.js';
import { handleRecap } from './commands/recap.js';
import { handleExport } from './commands/export.js';
import { handleCapture, handleUndo, UNDO_PREFIX } from './capture.js';
import { handlePhotoCapture } from './photo-capture.js';
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

  bot.command('today', (botCtx) => handleToday(ctx, botCtx));
  bot.command('budget', (botCtx) => handleBudget(ctx, botCtx));
  bot.command('recent', (botCtx) => handleRecent(ctx, botCtx));
  bot.command('undo', (botCtx) => handleUndoCommand(ctx, botCtx));
  bot.command('recurring', (botCtx) => handleRecurring(ctx, botCtx));
  bot.command('household', (botCtx) => handleHousehold(ctx, botCtx));
  bot.command('join', (botCtx) => handleJoin(ctx, botCtx));
  bot.command('switch', (botCtx) => handleSwitch(ctx, botCtx));
  bot.command('goals', (botCtx) => handleGoals(ctx, botCtx));
  bot.command('recap', (botCtx) => handleRecap(ctx, botCtx));
  bot.command('export', (botCtx) => handleExport(ctx, botCtx));

  bot.callbackQuery(new RegExp(`^${UNDO_PREFIX}`), (botCtx) => handleUndo(ctx, botCtx));

  // GUARDRAILS section 10: every callback query gets an answer, including the
  // ones nothing above claimed, or the client spins forever.
  bot.on('callback_query', (botCtx) => botCtx.answerCallbackQuery());

  // PRD F4: a captioned photo is captured exactly like a text message, plus
  // the photo attached. See bot/photo-capture.ts for why a caption (not OCR,
  // not yet) is what supplies the amount in v1.
  bot.on(':photo', (botCtx) => handlePhotoCapture(ctx, botCtx));

  /** Receipt PDFs are a later pass. A silent non-response would let someone
   * believe their document was filed. */
  bot.on(':document', async (botCtx) => {
    await botCtx.reply(
      "I can't read documents yet — send a photo instead, captioned with the amount: `12.50 lunch`",
      { parse_mode: 'Markdown' },
    );
  });

  bot.on([':voice', ':audio', ':video_note'], async (botCtx) => {
    await botCtx.reply("I can't listen to voice notes yet. Type it instead: `12.50 lunch`", {
      parse_mode: 'Markdown',
    });
  });

  // Anything else: try to read it as a transaction (PRD F1).
  bot.on('message:text', async (botCtx) => {
    const text = botCtx.message.text.trim();

    if (text.startsWith('/')) {
      await botCtx.reply("I don't know that command. Try /help.");
      return;
    }

    const captured = await handleCapture(ctx, botCtx);
    if (captured) return;

    await botCtx.reply(
      "I couldn't find an amount in that.\n\nTry `12.50 lunch` — amount first, then what it was for.",
      { parse_mode: 'Markdown' },
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

/** The webhook URL Telegram should deliver updates to, or null if we can't know it. */
export function desiredWebhookUrl(ctx: AppContext): string | null {
  const { serverUrl, autoSetWebhook } = ctx.config;
  if (!autoSetWebhook) return null;
  // Telegram only accepts HTTPS webhook URLs, so a local server cannot register.
  if (!serverUrl?.startsWith('https://')) return null;
  return `${serverUrl}/telegram/webhook`;
}

/**
 * Register the webhook with Telegram from inside the running server.
 *
 * Deploying otherwise requires running a script with the bot token on a
 * developer's machine. The server already knows its own URL and secret, so it
 * can do this itself — which also self-heals if the secret is rotated, since
 * `getWebhookInfo` never reveals the stored secret for us to compare against.
 *
 * Called once per boot, not per request.
 */
export async function ensureWebhook(
  bot: SpendlygoBot,
  ctx: AppContext,
): Promise<'registered' | 'skipped'> {
  const url = desiredWebhookUrl(ctx);

  if (!url) {
    logger.info('webhook.autoset_skipped', {
      reason: ctx.config.autoSetWebhook ? 'no_https_server_url' : 'disabled',
    });
    return 'skipped';
  }

  await bot.api.setWebhook(url, {
    secret_token: ctx.config.webhookSecretToken,
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    // Never drop queued updates: a transaction logged while we were restarting
    // must still arrive.
    drop_pending_updates: false,
  });

  const info = await bot.api.getWebhookInfo();
  logger.info('webhook.registered', {
    url: info.url,
    pending: info.pending_update_count,
    lastError: info.last_error_message ?? null,
  });

  return 'registered';
}

/**
 * One-time setup of the command menu and the chat menu button.
 *
 * Idempotent, so it is safe to run on every boot — and a boot is the only time
 * we can be sure the deployed code and the menu agree.
 */
export async function configureBotMenu(bot: SpendlygoBot, ctx: AppContext): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'today', description: "What's safe to spend today" },
    { command: 'app', description: 'Open Spendlygo' },
    { command: 'budget', description: 'Show or set your monthly budget' },
    { command: 'recent', description: 'Your last 10 entries' },
    { command: 'undo', description: 'Undo the last entry' },
    { command: 'recurring', description: 'Rent, salary and subscriptions' },
    { command: 'household', description: 'Share a budget with a partner' },
    { command: 'switch', description: 'Move between your spaces' },
    { command: 'goals', description: 'Savings goals and progress' },
    { command: 'recap', description: 'Your month or year at a glance' },
    { command: 'export', description: 'Download your data as CSV' },
    { command: 'help', description: 'How to log a spend' },
    { command: 'start', description: 'Start over' },
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
