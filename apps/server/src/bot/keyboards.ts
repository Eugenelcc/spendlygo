import { InlineKeyboard } from 'grammy';
import type { Config } from '../config.js';

/**
 * Telegram only accepts HTTPS URLs in `web_app` buttons, so a local
 * `http://localhost` Mini App cannot be attached. Rather than crash in
 * development, we omit the button and say so.
 */
export function canLaunchMiniApp(config: Config): boolean {
  return config.miniappUrl.startsWith('https://');
}

export function openAppKeyboard(
  config: Config,
  label = '📊 Open Spendlygo',
): InlineKeyboard | undefined {
  if (!canLaunchMiniApp(config)) return undefined;
  return new InlineKeyboard().webApp(label, config.miniappUrl);
}
