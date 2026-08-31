/**
 * Photo attachments in chat (PRD F4, F4.6).
 *
 * The amount can come from two places: a caption, using the exact same
 * grammar as plain-text capture (`12.50 lunch`) — always tried first, since
 * a caption is an explicit statement of intent OCR shouldn't second-guess —
 * or, for a captionless photo with OCR configured, a guess read off the
 * receipt itself (ADR 0005). Either way the user sees exactly what was
 * saved and can undo it; OCR's guess is never presented as more certain
 * than a caption would have been.
 *
 * A captionless photo when OCR is unavailable or finds nothing: no
 * transaction is created, and the photo is not held onto waiting for a
 * follow-up message (that would need in-memory per-user state this
 * codebase otherwise avoids) — the user is asked to resend it captioned.
 */

import { formatCents, type AmountCents } from '@spendlygo/core';
import { attachmentsRepo, transactionsRepo } from '@spendlygo/db';
import type { PhotoSize } from 'grammy/types';
import { computeSafeToSpend, todayFor } from '../api/service.js';
import type { AppContext } from '../context.js';
import { guessReceiptAmount } from '../telegram/ocr.js';
import { resolveFileUrl } from '../telegram/photos.js';
import { buildConfirmation, captureFromText, undoKeyboard } from './capture.js';
import type { BotContext } from './middleware.js';

const NO_CAPTION_NO_OCR = [
  'Got the photo — send it with a caption so I know the amount:',
  '`12.50 lunch`',
].join('\n');

const NO_CAPTION_OCR_FAILED = [
  "Got the photo, but couldn't read an amount off it.",
  '',
  'Send it again with a caption: `12.50 lunch`',
].join('\n');

export async function handlePhotoCapture(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const photos = botCtx.message?.photo;
  const caption = botCtx.message?.caption;
  if (!photos || photos.length === 0) return;

  // Telegram sends every resolution it generated, smallest first.
  const largest = photos[photos.length - 1] as PhotoSize | undefined;
  if (!largest) return;

  if (caption) {
    await captureWithCaption(ctx, botCtx, caption, largest);
    return;
  }

  await captureWithOcr(ctx, botCtx, largest);
}

async function attachPhoto(
  ctx: AppContext,
  botCtx: BotContext,
  transactionId: string,
  photo: PhotoSize,
  ocr: { status: 'none' } | { status: 'done'; amountCents: AmountCents } | { status: 'failed' },
): Promise<void> {
  await attachmentsRepo.create(ctx.db, {
    transactionId,
    userId: botCtx.appUser.id,
    tgFileId: photo.file_id,
    tgFileUniqueId: photo.file_unique_id,
    width: photo.width,
    height: photo.height,
    fileSize: photo.file_size ?? null,
    ocrStatus: ocr.status,
    ocrPayload: ocr.status === 'done' ? { amountCents: ocr.amountCents } : null,
  });
}

async function captureWithCaption(
  ctx: AppContext,
  botCtx: BotContext,
  caption: string,
  photo: PhotoSize,
): Promise<void> {
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

  await attachPhoto(ctx, botCtx, outcome.transactionId, photo, { status: 'none' });
}

/**
 * No caption: try OCR (PRD F4.6). Falls back to asking for a caption if OCR
 * is unavailable, times out, or can't find a plausible amount — the same
 * request a captionless photo always got, just with a truer reason why.
 */
async function captureWithOcr(
  ctx: AppContext,
  botCtx: BotContext,
  photo: PhotoSize,
): Promise<void> {
  const apiKey = ctx.config.ocrSpaceApiKey;
  if (!apiKey) {
    await botCtx.reply(NO_CAPTION_NO_OCR, { parse_mode: 'Markdown' });
    return;
  }

  const url = await resolveFileUrl(botCtx.api, ctx.config.botToken, photo.file_id);
  const guessedCents = url ? await downloadAndGuess(url, apiKey) : null;

  if (guessedCents === null) {
    await botCtx.reply(NO_CAPTION_OCR_FAILED, { parse_mode: 'Markdown' });
    return;
  }

  const user = botCtx.appUser;
  const today = todayFor(ctx, user);

  const created = await transactionsRepo.create(ctx.db, {
    userId: user.id,
    householdId: user.householdId,
    direction: 'out',
    amountCents: guessedCents,
    categoryId: null,
    note: null,
    occurredOn: today,
    source: 'chat',
  });

  await attachPhoto(ctx, botCtx, created.id, photo, { status: 'done', amountCents: guessedCents });

  const safeToSpend = await computeSafeToSpend(ctx, user, today);
  const message = buildConfirmation({
    direction: 'out',
    amountCents: guessedCents,
    categoryEmoji: null,
    categoryName: null,
    note: null,
    occurredOn: today,
    today,
    currency: user.currency,
    locale: user.locale,
    safeTodayCents: safeToSpend.safeTodayCents,
    leftForTodayCents: safeToSpend.leftForTodayCents,
    hasBudget: safeToSpend.hasBudget,
    overspentCents: safeToSpend.overspentCents,
  });

  const money = formatCents(guessedCents, { currency: user.currency, locale: user.locale });
  await botCtx.reply(
    `📸 _Guessed ${money} from your receipt — open the app to fix it if that's wrong._\n\n${message}`,
    { parse_mode: 'Markdown', reply_markup: undoKeyboard(created.id) },
  );
}

async function downloadAndGuess(url: string, apiKey: string): Promise<AmountCents | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    return await guessReceiptAmount(bytes, apiKey);
  } catch {
    return null;
  }
}
