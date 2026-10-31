/**
 * Unit tests for the Frankfurter FX client (ADR 0007). `fetch` is mocked
 * throughout: never call the real API from tests. Unlike OCR, failures must
 * resolve to `null`, never a guessed rate — the caller decides what that
 * means for the user.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFxRate } from './fx.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      ...response,
    }),
  );
}

describe('fetchFxRate', () => {
  it('returns 1 without a network call when the currencies match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('should not be called')));
    await expect(fetchFxRate('USD', 'USD')).resolves.toBe(1);
  });

  it('reads the rate out of a successful response', async () => {
    mockFetchOnce({ json: async () => ({ amount: 1, base: 'USD', rates: { SGD: 1.35 } }) });
    await expect(fetchFxRate('USD', 'SGD')).resolves.toBe(1.35);
  });

  it('returns null on an HTTP error, never throws', async () => {
    mockFetchOnce({ ok: false, status: 500 });
    await expect(fetchFxRate('USD', 'SGD')).resolves.toBeNull();
  });

  it('returns null when the target currency is missing from the response', async () => {
    mockFetchOnce({ json: async () => ({ amount: 1, base: 'USD', rates: {} }) });
    await expect(fetchFxRate('USD', 'SGD')).resolves.toBeNull();
  });

  it('returns null on a zero or negative rate rather than trusting it', async () => {
    mockFetchOnce({ json: async () => ({ rates: { SGD: 0 } }) });
    await expect(fetchFxRate('USD', 'SGD')).resolves.toBeNull();
  });

  it('returns null rather than throwing on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    await expect(fetchFxRate('USD', 'SGD')).resolves.toBeNull();
  });

  it('returns null rather than throwing on a malformed (non-JSON) response', async () => {
    mockFetchOnce({
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    await expect(fetchFxRate('USD', 'SGD')).resolves.toBeNull();
  });
});
