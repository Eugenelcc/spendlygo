/**
 * Register the webhook with Telegram.
 *
 * Run once after the first deploy, and again whenever SERVER_URL or
 * TELEGRAM_WEBHOOK_SECRET changes.
 */
import { Bot } from 'grammy';
import { loadConfig } from '../config.js';

const config = loadConfig();

if (!config.serverUrl) {
  console.error('SERVER_URL is not set — point it at the deployed server.');
  process.exit(1);
}

if (!config.serverUrl.startsWith('https://')) {
  console.error(`Telegram requires an HTTPS webhook URL. Got: ${config.serverUrl}`);
  process.exit(1);
}

const url = `${config.serverUrl}/telegram/webhook`;
const bot = new Bot(config.botToken);

await bot.api.setWebhook(url, {
  secret_token: config.webhookSecret,
  allowed_updates: ['message', 'callback_query', 'my_chat_member'],
  drop_pending_updates: false,
});

const info = await bot.api.getWebhookInfo();
console.log('✓ Webhook registered.');
console.log(`  url:              ${info.url}`);
console.log(`  pending updates:  ${info.pending_update_count}`);
if (info.last_error_message) {
  console.log(`  last error:       ${info.last_error_message}`);
}
