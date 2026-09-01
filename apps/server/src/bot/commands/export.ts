/**
 * /export — CSV export (PRD F8), the bot half of the shared builder in
 * apps/server/src/api/export.ts. Sent as a Telegram document (F8.2): never
 * written to disk, and there is no persistent disk on this runtime to write
 * to regardless.
 *
 *   /export             everything
 *   /export 2026        one year
 *   /export 2026-08     one month
 */

import { InputFile } from 'grammy';
import { buildExportCsv, exportFilename, parseExportRange } from '../../api/export.js';
import type { AppContext } from '../../context.js';
import type { BotContext } from '../middleware.js';

export async function handleExport(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const argument = botCtx.match?.toString().trim() ?? '';

  const range = parseExportRange(argument);
  if (!range) {
    await botCtx.reply(
      [
        'Usage:',
        '`/export` — everything',
        '`/export 2026` — one year',
        '`/export 2026-08` — one month',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const csv = await buildExportCsv(ctx, user, range);
  const rowCount = csv.split('\r\n').length - 2; // header + trailing blank line

  if (rowCount <= 0) {
    await botCtx.reply(
      `Nothing logged for ${range.label === 'all-time' ? 'any period yet' : range.label}.`,
    );
    return;
  }

  await botCtx.replyWithDocument(new InputFile(Buffer.from(csv, 'utf8'), exportFilename(range)), {
    caption: `${rowCount} ${rowCount === 1 ? 'entry' : 'entries'} · ${range.label}`,
  });
}
