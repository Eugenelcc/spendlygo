/**
 * /export — CSV export (PRD F8), the bot half of the shared builder in
 * apps/server/src/api/export.ts. Sent as a Telegram document (F8.2): never
 * written to disk, and there is no persistent disk on this runtime to write
 * to regardless.
 *
 *   /export             everything
 *   /export cycle       this pay cycle (F17)
 *   /export last cycle  the previous pay cycle
 *   /export 2026        one calendar year
 *   /export 2026-08     one calendar month
 *   /export 2026-10-05..2026-10-24  custom dates
 */

import { InputFile } from 'grammy';
import {
  cycleContaining,
  formatCycleRange,
  previousCycle,
  type BudgetCycle,
} from '@spendlygo/core';
import { buildExportCsv, parseExportRange } from '../../api/export.js';
import { activeSpaceSettings, todayFor } from '../../api/service.js';
import type { AppContext } from '../../context.js';
import type { BotContext } from '../middleware.js';

/** The usage hint. Cycle lines name the ranges unless the start day is 1 (copy rule). */
export function exportUsageText(cycle: BudgetCycle): string {
  const previous = previousCycle(cycle);
  const named = cycle.startDay !== 1;
  return [
    'Usage:',
    '`/export` — everything',
    `\`/export cycle\` — ${named ? `this cycle (${formatCycleRange(cycle)})` : 'this month'}`,
    `\`/export last cycle\` — ${named ? `last cycle (${formatCycleRange(previous)})` : 'last month'}`,
    '`/export 2026` — one year',
    '`/export 2026-08` — one month',
    '`/export 2026-10-05..2026-10-24` — custom dates',
  ].join('\n');
}

export async function handleExport(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const argument = botCtx.match?.toString().trim() ?? '';

  const { cycleStartDay } = await activeSpaceSettings(ctx, user);
  const today = todayFor(ctx, user);
  const range = parseExportRange(argument, { today, cycleStartDay });
  if (!range) {
    await botCtx.reply(exportUsageText(cycleContaining(today, cycleStartDay)), {
      parse_mode: 'Markdown',
    });
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

  await botCtx.replyWithDocument(new InputFile(Buffer.from(csv, 'utf8'), range.filename), {
    caption: `${rowCount} ${rowCount === 1 ? 'entry' : 'entries'} · ${range.label}`,
  });
}
