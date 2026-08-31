/**
 * Photo attachments in chat (PRD F4) — v1, no OCR.
 *
 * Without OCR, the amount has to come from somewhere: a caption, using the
 * exact same grammar as plain-text capture (`12.50 lunch`). No caption means
 * no transaction is created — nothing is saved half-finished, and the photo
 * is not held onto waiting for a follow-up message (that would need in-memory
 * per-user state this codebase otherwise avoids). Once OCR lands, this is
 * exactly the branch that gets a guessed amount instead of a request to type
 * one — see docs/adr/0005-receipt-ocr-via-ocr-space.md.
 */

import { attachmentsRepo } from '@spendlygo/db';
import type { AppContext } from '../context.js';
import { captureFromText } from './capture.js';
import type { BotContext } from './middleware.js';

export async function handlePhotoCapture(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const photos = botCtx.message?.photo;
  const caption = botCtx.message?.caption;
  if (!photos || photos.length === 0) return;

  if (!caption) {
    await botCtx.reply(
      [
        'Got the photo — send it with a caption so I know the amount:',
        '`12.50 lunch`',
        '',
        "_Soon I'll be able to read the receipt for you._",
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const outcome = await captureFromText(ctx, botCtx, caption);

  if (outcome.kind === 'not_a_capture') {
    await botCtx.reply(
      "I couldn't find an amount in that caption.\n\nTry captioning the photo `12.50 lunch`.",
      { parse_mode: 'Markdown' },
    );
    return;
  }
  // 'bad_date' already got its own reply from captureFromText.
  if (outcome.kind !== 'saved') return;

  // Telegram sends every resolution it generated, smallest first.
  const largest = photos[photos.length - 1];
  if (!largest) return;

  await attachmentsRepo.create(ctx.db, {
    transactionId: outcome.transactionId,
    userId: botCtx.appUser.id,
    tgFileId: largest.file_id,
    tgFileUniqueId: largest.file_unique_id,
    width: largest.width,
    height: largest.height,
    fileSize: largest.file_size ?? null,
  });
}
