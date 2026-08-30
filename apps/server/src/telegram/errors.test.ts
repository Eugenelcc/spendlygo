import { GrammyError } from 'grammy';
import { describe, expect, it } from 'vitest';
import { isPermanentTelegramError } from './errors.js';

/** GrammyError's constructor wants the raw API response shape. */
function apiError(code: number, description: string): GrammyError {
  return new GrammyError(
    `Call to 'setWebhook' failed!`,
    { ok: false, error_code: code, description },
    'setWebhook',
    {},
  );
}

describe('isPermanentTelegramError', () => {
  it('treats a 400 as permanent — this is the real one we hit', () => {
    // Render's generateValue produced a base64 secret; Telegram refused it on
    // every retry for five minutes before we noticed.
    const error = apiError(400, 'Bad Request: secret token contains illegal characters');
    expect(isPermanentTelegramError(error)).toBe(true);
  });

  it.each([
    [401, 'Unauthorized'],
    [403, 'Forbidden: bot was blocked by the user'],
    [404, 'Not Found'],
  ])('treats %i as permanent', (code, description) => {
    expect(isPermanentTelegramError(apiError(code, description))).toBe(true);
  });

  it('treats 429 as retryable — it explicitly asks us to try again', () => {
    expect(isPermanentTelegramError(apiError(429, 'Too Many Requests: retry after 5'))).toBe(false);
  });

  it.each([500, 502, 503])('treats %i as retryable', (code) => {
    expect(isPermanentTelegramError(apiError(code, 'Internal Server Error'))).toBe(false);
  });

  it('treats a network error as retryable', () => {
    expect(isPermanentTelegramError(new Error('fetch failed'))).toBe(false);
    expect(isPermanentTelegramError(undefined)).toBe(false);
  });
});
