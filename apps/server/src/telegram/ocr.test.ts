/**
 * Unit tests for the OCR.space HTTP client — the I/O wrapper around
 * packages/core/src/receipt-text.ts's already-tested text heuristic.
 * `fetch` is mocked throughout: never call the real OCR.space API from
 * tests, and every failure mode here must resolve to `null`, never throw.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { centsOf } from '@spendlygo/core';
import { guessReceiptAmount } from './ocr.js';

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

describe('guessReceiptAmount', () => {
  it('reads a total out of a successful response', async () => {
    mockFetchOnce({
      json: async () => ({
        IsErroredOnProcessing: false,
        ParsedResults: [{ ParsedText: 'Latte  4.50\nTOTAL  4.50' }],
      }),
    });
    const result = await guessReceiptAmount(new ArrayBuffer(0), 'test-key');
    expect(result).toBe(centsOf(450));
  });

  it('returns null on an HTTP error, never throws', async () => {
    mockFetchOnce({ ok: false, status: 500 });
    await expect(guessReceiptAmount(new ArrayBuffer(0), 'test-key')).resolves.toBeNull();
  });

  it('returns null when OCR.space reports a processing error', async () => {
    mockFetchOnce({ json: async () => ({ IsErroredOnProcessing: true }) });
    const result = await guessReceiptAmount(new ArrayBuffer(0), 'test-key');
    expect(result).toBeNull();
  });

  it('returns null when there are no parsed results', async () => {
    mockFetchOnce({ json: async () => ({ IsErroredOnProcessing: false, ParsedResults: [] }) });
    const result = await guessReceiptAmount(new ArrayBuffer(0), 'test-key');
    expect(result).toBeNull();
  });

  it('returns null when the parsed text has nothing money-shaped', async () => {
    mockFetchOnce({
      json: async () => ({
        IsErroredOnProcessing: false,
        ParsedResults: [{ ParsedText: 'Thank you for shopping with us!' }],
      }),
    });
    const result = await guessReceiptAmount(new ArrayBuffer(0), 'test-key');
    expect(result).toBeNull();
  });

  it('returns null rather than throwing on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    await expect(guessReceiptAmount(new ArrayBuffer(0), 'test-key')).resolves.toBeNull();
  });

  it('returns null rather than throwing on a malformed (non-JSON) response', async () => {
    mockFetchOnce({
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    await expect(guessReceiptAmount(new ArrayBuffer(0), 'test-key')).resolves.toBeNull();
  });

  it('sends the image as multipart form data, never a URL', async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedBody = init.body;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            IsErroredOnProcessing: false,
            ParsedResults: [{ ParsedText: 'TOTAL 1.00' }],
          }),
        });
      }),
    );
    await guessReceiptAmount(new ArrayBuffer(8), 'test-key');
    expect(capturedBody).toBeInstanceOf(FormData);
  });
});
