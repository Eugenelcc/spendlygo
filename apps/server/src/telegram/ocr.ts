/**
 * Receipt OCR via OCR.space (PRD F4.6, ADR 0005).
 *
 * The only thing sent to OCR.space is the image's bytes — never the
 * `file_id`, the resolved (token-bearing) Telegram URL, or anything else
 * about the user (GUARDRAILS.md section 6's exact scope for this exception).
 * The image is fetched from Telegram ourselves and re-uploaded as bytes,
 * specifically so OCR.space never receives a URL that could be replayed.
 *
 * Never throws: any failure — no key configured, a timeout, a malformed
 * response, nothing money-shaped in the text — resolves to `null`, and the
 * caller degrades to asking the user to type the amount (PRD F4, no
 * different from a photo sent before this feature existed).
 */

import { extractReceiptTotalCents, type AmountCents } from '@spendlygo/core';
import { describeError, logger } from '../logger.js';

const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';
const TIMEOUT_MS = 15_000;

interface OcrSpaceResult {
  ParsedText?: string;
}

interface OcrSpaceResponse {
  IsErroredOnProcessing?: boolean;
  ParsedResults?: OcrSpaceResult[];
}

export async function guessReceiptAmount(
  imageBytes: ArrayBuffer,
  apiKey: string,
): Promise<AmountCents | null> {
  try {
    const form = new FormData();
    form.append('apikey', apiKey);
    form.append('language', 'eng');
    // Engine 2 reads numbers and receipts more reliably than the default.
    form.append('OCREngine', '2');
    form.append('scale', 'true');
    form.append('file', new Blob([imageBytes]), 'receipt.jpg');

    const response = await fetch(OCR_SPACE_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn('ocr.http_error', { status: response.status });
      return null;
    }

    const data = (await response.json()) as OcrSpaceResponse;
    if (data.IsErroredOnProcessing) {
      logger.warn('ocr.processing_error');
      return null;
    }

    const text = data.ParsedResults?.[0]?.ParsedText;
    if (!text) return null;

    // GUARDRAILS.md section 6: never log the receipt's actual content.
    return extractReceiptTotalCents(text);
  } catch (error) {
    logger.warn('ocr.failed', describeError(error));
    return null;
  }
}
