/**
 * Live exchange rates via Frankfurter (ADR 0007) — free, no API key, backed
 * by European Central Bank reference rates. Used only to convert a
 * foreign-currency capture into the user's home currency at log time; the
 * rate returned is stored on the transaction (`fxRate`) so a later rate move
 * never silently re-prices old history.
 *
 * Unlike OCR (apps/server/src/telegram/ocr.ts), a failed fetch here is NOT
 * degraded silently to a guess — without a real rate there is no honest
 * amountCents to store, so the caller surfaces an error and asks the user to
 * retry, rather than inventing a conversion (GUARDRAILS.md section 2).
 */

import { describeError, logger } from './logger.js';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';
const TIMEOUT_MS = 8_000;

interface FrankfurterResponse {
  rates?: Record<string, number>;
}

/** `null` on any failure — unreachable host, timeout, unknown currency pair. */
export async function fetchFxRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1;

  try {
    const url = `${FRANKFURTER_URL}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

    if (!response.ok) {
      logger.warn('fx.http_error', { status: response.status, from, to });
      return null;
    }

    const data = (await response.json()) as FrankfurterResponse;
    const rate = data.rates?.[to];
    if (typeof rate !== 'number' || !(rate > 0)) {
      logger.warn('fx.no_rate', { from, to });
      return null;
    }
    return rate;
  } catch (error) {
    logger.warn('fx.failed', describeError(error));
    return null;
  }
}
