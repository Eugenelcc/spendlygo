import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '@spendlygo/core';
import { buildDataCheckString, validateInitData } from './init-data.js';

const BOT_TOKEN = '123456:test-token-not-a-real-secret';

/**
 * Signs a payload independently of the implementation under test, so a
 * refactor that breaks the algorithm fails here rather than in production.
 */
function makeInitData(fields: Record<string, string>, token: string = BOT_TOKEN): string {
  const dataCheckString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

const nowSeconds = Math.floor(Date.UTC(2026, 7, 27, 12, 0, 0) / 1000);
const NOW = new Date(nowSeconds * 1000);

const validFields = {
  auth_date: String(nowSeconds - 60),
  query_id: 'AAE1234',
  user: JSON.stringify({
    id: 987654321,
    first_name: 'Eugene',
    username: 'eugene',
    language_code: 'en',
    is_premium: true,
  }),
};

describe('validateInitData', () => {
  it('accepts a correctly signed payload and extracts the user', () => {
    const result = validateInitData(makeInitData(validFields), BOT_TOKEN, { now: NOW });

    expect(result.user.id).toBe(987654321n);
    expect(result.user.firstName).toBe('Eugene');
    expect(result.user.username).toBe('eugene');
    expect(result.user.isPremium).toBe(true);
    expect(result.queryId).toBe('AAE1234');
  });

  it('rejects a payload signed with a different bot token', () => {
    const forged = makeInitData(validFields, '999999:someone-elses-token');
    expect(() => validateInitData(forged, BOT_TOKEN, { now: NOW })).toThrow(UnauthorizedError);
  });

  it('rejects a tampered user id — the whole point of this function', () => {
    const signed = makeInitData(validFields);
    const params = new URLSearchParams(signed);
    params.set('user', JSON.stringify({ id: 1, first_name: 'Attacker' }));

    expect(() => validateInitData(params.toString(), BOT_TOKEN, { now: NOW })).toThrow(
      UnauthorizedError,
    );
  });

  it('rejects an unsigned payload', () => {
    const params = new URLSearchParams(validFields);
    expect(() => validateInitData(params.toString(), BOT_TOKEN, { now: NOW })).toThrow(
      /not signed/,
    );
  });

  it('rejects an empty payload', () => {
    expect(() => validateInitData('', BOT_TOKEN, { now: NOW })).toThrow(/Missing initData/);
  });

  it('rejects a payload older than the max age', () => {
    const stale = makeInitData({ ...validFields, auth_date: String(nowSeconds - 86_401) });
    expect(() => validateInitData(stale, BOT_TOKEN, { now: NOW })).toThrow(/expired/);
  });

  it('accepts a payload just inside the max age', () => {
    const fresh = makeInitData({ ...validFields, auth_date: String(nowSeconds - 86_399) });
    expect(validateInitData(fresh, BOT_TOKEN, { now: NOW }).user.id).toBe(987654321n);
  });

  it('rejects a payload dated in the future beyond clock drift', () => {
    const future = makeInitData({ ...validFields, auth_date: String(nowSeconds + 3600) });
    expect(() => validateInitData(future, BOT_TOKEN, { now: NOW })).toThrow(/future/);
  });

  it('rejects a payload with no user', () => {
    const { user: _user, ...withoutUser } = validFields;
    const signed = makeInitData(withoutUser);
    expect(() => validateInitData(signed, BOT_TOKEN, { now: NOW })).toThrow(/no user/);
  });

  it('keeps `signature` inside the data-check string', () => {
    // Telegram removes only `hash`; dropping `signature` too would break
    // validation for clients that send it.
    const params = new URLSearchParams({ a: '1', signature: 'sig', hash: 'h', b: '2' });
    expect(buildDataCheckString(params)).toBe('a=1\nb=2\nsignature=sig');
  });

  it('sorts data-check pairs by key', () => {
    const params = new URLSearchParams({ zeta: '1', alpha: '2', hash: 'x' });
    expect(buildDataCheckString(params)).toBe('alpha=2\nzeta=1');
  });
});
