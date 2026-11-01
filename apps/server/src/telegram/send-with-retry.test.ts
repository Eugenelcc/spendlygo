/**
 * sendMessageWithRetry (B-032 Part 4, GUARDRAILS section 10): a 429 is retried
 * once when Telegram asks for 3 seconds or less; anything else is rethrown.
 * Written before the helper exists.
 */

import { GrammyError, type Api } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { sendMessageWithRetry } from './send-with-retry.js';

function apiError(code: number, description: string, retryAfter?: number): GrammyError {
  return new GrammyError(
    `Call to 'sendMessage' failed!`,
    {
      ok: false,
      error_code: code,
      description,
      ...(retryAfter === undefined ? {} : { parameters: { retry_after: retryAfter } }),
    },
    'sendMessage',
    {},
  );
}

function apiWith(sendMessage: ReturnType<typeof vi.fn>): Api {
  return { sendMessage } as unknown as Api;
}

describe('sendMessageWithRetry', () => {
  it('sends once when it works', async () => {
    const send = vi.fn().mockResolvedValue({});
    const sleep = vi.fn().mockResolvedValue(undefined);
    await sendMessageWithRetry(apiWith(send), '42', 'hello', sleep);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('42', 'hello');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a 429 once after retry_after seconds when it is 3 or less', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(apiError(429, 'Too Many Requests: retry after 3', 3))
      .mockResolvedValue({});
    const sleep = vi.fn().mockResolvedValue(undefined);
    await sendMessageWithRetry(apiWith(send), '42', 'hello', sleep);
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 429 that asks for more than 3 seconds', async () => {
    const send = vi.fn().mockRejectedValue(apiError(429, 'Too Many Requests: retry after 4', 4));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(sendMessageWithRetry(apiWith(send), '42', 'hello', sleep)).rejects.toBeInstanceOf(
      GrammyError,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('rethrows when the retry fails too (only one retry)', async () => {
    const send = vi.fn().mockRejectedValue(apiError(429, 'Too Many Requests: retry after 1', 1));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(sendMessageWithRetry(apiWith(send), '42', 'hello', sleep)).rejects.toBeInstanceOf(
      GrammyError,
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 403 (bot blocked)', async () => {
    const send = vi.fn().mockRejectedValue(apiError(403, 'Forbidden: bot was blocked by the user'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(sendMessageWithRetry(apiWith(send), '42', 'hello', sleep)).rejects.toBeInstanceOf(
      GrammyError,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
