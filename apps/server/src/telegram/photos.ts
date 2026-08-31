/**
 * Resolving a Telegram `file_id` to a downloadable URL (PRD F4.2).
 *
 * `getFile`'s resulting URL embeds the bot token
 * (`https://api.telegram.org/file/bot<TOKEN>/<path>`) and expires in about an
 * hour. GUARDRAILS.md section 5: that URL must never reach the client — it's
 * cached here, server-side only, and every caller fetches the bytes through
 * it rather than handing the URL out.
 */

import type { SpendlygoBot } from '../bot/index.js';
import { describeError, logger } from '../logger.js';

// Telegram's own URL lasts ~60 minutes; re-resolving a little early avoids a
// request landing right as it expires (CLAUDE.md gotchas).
const CACHE_TTL_MS = 50 * 60 * 1000;

interface CachedUrl {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CachedUrl>();

/** Null on any failure — an expired or invalid `file_id`, a Telegram outage. */
export async function resolveFileUrl(
  bot: SpendlygoBot,
  botToken: string,
  fileId: string,
): Promise<string | null> {
  const cached = cache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  try {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) return null;

    const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
    cache.set(fileId, { url, expiresAt: Date.now() + CACHE_TTL_MS });
    return url;
  } catch (error) {
    logger.warn('photos.resolve_failed', describeError(error));
    return null;
  }
}
