/** Unregister the webhook — needed before running the bot locally via polling. */
import { Bot } from 'grammy';
import { loadConfig } from '../config.js';

const config = loadConfig();
const bot = new Bot(config.botToken);

await bot.api.deleteWebhook({ drop_pending_updates: false });
console.log('✓ Webhook removed.');
