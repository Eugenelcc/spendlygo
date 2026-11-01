import { GrammyError, type Api } from 'grammy';

/** Telegram asks for at most this many seconds before we give up waiting (GUARDRAILS §10). */
const MAX_RETRY_AFTER_SECONDS = 3;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Send a plain-text message. A 429 that asks for 3 seconds or less is waited
 * out and retried exactly once; every other failure (a second failure, a longer
 * wait, 403 blocked, 5xx) is rethrown for the caller to log.
 */
export async function sendMessageWithRetry(
  api: Api,
  chatId: string,
  text: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  try {
    await api.sendMessage(chatId, text);
  } catch (error) {
    const retryAfter =
      error instanceof GrammyError && error.error_code === 429
        ? error.parameters.retry_after
        : undefined;
    if (retryAfter === undefined || retryAfter > MAX_RETRY_AFTER_SECONDS) throw error;
    await sleep(retryAfter * 1000);
    await api.sendMessage(chatId, text);
  }
}
