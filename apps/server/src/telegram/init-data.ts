/**
 * Telegram Mini App `initData` validation.
 *
 * GUARDRAILS.md section 4 — this is the single most security-critical function
 * in the codebase. The client controls the entire `initData` payload, so the
 * user id it claims means nothing until the HMAC signature is verified against
 * the bot token. Nothing downstream may read `user.id` from an unvalidated
 * payload.
 *
 * Algorithm (Telegram Mini Apps, "Validating data received via the Mini App"):
 *   1. Parse the query string; take out `hash`.
 *   2. Sort the remaining pairs by key, join as `key=value` with "\n".
 *      Only `hash` is removed — `signature`, when present, stays in the string.
 *   3. secret  = HMAC_SHA256(key = "WebAppData", message = BOT_TOKEN)
 *   4. expected = HMAC_SHA256(key = secret, message = dataCheckString)
 *   5. Compare with `hash` in constant time.
 *   6. Reject anything older than `maxAgeSeconds`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '@spendlygo/core';

export interface InitDataUser {
  id: bigint;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  isPremium: boolean;
}

export interface ValidatedInitData {
  user: InitDataUser;
  authDate: Date;
  queryId: string | null;
  startParam: string | null;
}

export interface ValidateInitDataOptions {
  /** Default 24 hours, per GUARDRAILS.md section 4. */
  maxAgeSeconds?: number;
  /** Injected so expiry is testable without faking the system clock. */
  now?: Date;
}

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function buildDataCheckString(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  return pairs.sort().join('\n');
}

export function signInitData(dataCheckString: string, botToken: string): string {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

export function validateInitData(
  initData: string,
  botToken: string,
  options: ValidateInitDataOptions = {},
): ValidatedInitData {
  const { maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS, now = new Date() } = options;

  if (!initData) throw new UnauthorizedError('Missing initData');

  const params = new URLSearchParams(initData);

  const hash = params.get('hash');
  if (!hash) throw new UnauthorizedError('initData is not signed');

  const expected = signInitData(buildDataCheckString(params), botToken);
  if (!constantTimeEquals(hash, expected)) {
    throw new UnauthorizedError('initData signature is invalid');
  }

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw || !/^\d+$/.test(authDateRaw)) {
    throw new UnauthorizedError('initData has no auth_date');
  }

  const authDate = new Date(Number(authDateRaw) * 1000);
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > maxAgeSeconds) {
    throw new UnauthorizedError('initData has expired — reopen the app');
  }
  // A future auth_date means a tampered or badly-skewed client. Allow a minute
  // of clock drift, no more.
  if (ageSeconds < -60) {
    throw new UnauthorizedError('initData is dated in the future');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new UnauthorizedError('initData carries no user');

  let parsed: unknown;
  try {
    parsed = JSON.parse(userRaw);
  } catch {
    throw new UnauthorizedError('initData user is not valid JSON');
  }

  const candidate = parsed as Record<string, unknown>;
  const id = candidate.id;
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new UnauthorizedError('initData user has no id');
  }

  return {
    user: {
      id: BigInt(id),
      firstName: typeof candidate.first_name === 'string' ? candidate.first_name : null,
      lastName: typeof candidate.last_name === 'string' ? candidate.last_name : null,
      username: typeof candidate.username === 'string' ? candidate.username : null,
      languageCode: typeof candidate.language_code === 'string' ? candidate.language_code : null,
      isPremium: candidate.is_premium === true,
    },
    authDate,
    queryId: params.get('query_id'),
    startParam: params.get('start_param'),
  };
}
