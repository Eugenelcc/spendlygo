import { GrammyError } from 'grammy';

/**
 * Whether a Telegram API failure will fail identically on every retry.
 *
 * Telegram answers a malformed request with 4xx — a bad webhook URL, a secret
 * token containing illegal characters, a revoked token. Retrying those is
 * pointless and buries the real error in a scrolling log. 429 is the exception:
 * it is a 4xx that explicitly asks us to try again later.
 */
export function isPermanentTelegramError(error: unknown): boolean {
  if (!(error instanceof GrammyError)) return false;

  const status = error.error_code;
  if (status === 429) return false;
  return status >= 400 && status < 500;
}
