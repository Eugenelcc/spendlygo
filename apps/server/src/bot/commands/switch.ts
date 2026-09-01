/**
 * /switch — move between spaces you already belong to (PRD-adjacent, the
 * multi-space feature). Never joins a new one — that's /join CODE — and
 * never removes you from any other membership.
 *
 *   /switch          list your spaces, numbered, with the active one marked
 *   /switch 2        switch to that numbered space
 */

import { householdsRepo, JoinHouseholdError, type Household, type User } from '@spendlygo/db';
import { activeHouseholdId } from '../../api/service.js';
import type { AppContext } from '../../context.js';
import { openAppKeyboard } from '../keyboards.js';
import { escapeMarkdown as escape } from '../markdown.js';
import type { BotContext } from '../middleware.js';

async function labelFor(ctx: AppContext, user: User, space: Household): Promise<string> {
  if (space.isPersonal) return 'Personal';
  const members = await householdsRepo.membersOf(ctx.db, space.id);
  const others = members
    .filter((member) => member.id !== user.id)
    .map((member) => member.firstName ?? 'a partner');
  return others.length > 0 ? `You & ${others.join(' & ')}` : 'Shared (just you so far)';
}

async function describeSpaces(
  ctx: AppContext,
  user: User,
  spaces: readonly Household[],
): Promise<string> {
  const active = activeHouseholdId(user);
  const lines = await Promise.all(
    spaces.map(async (space, index) => {
      const label = escape(await labelFor(ctx, user, space));
      return `${index + 1}. ${label}${space.id === active ? ' _(active)_' : ''}`;
    }),
  );
  return ['*Your spaces*', '', ...lines, '', 'Switch with `/switch 2`.'].join('\n');
}

export async function handleSwitch(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const argument = botCtx.match?.toString().trim() ?? '';
  const spaces = await householdsRepo.mySpaces(ctx.db, user.id);

  if (argument === '') {
    await botCtx.reply(await describeSpaces(ctx, user, spaces), { parse_mode: 'Markdown' });
    return;
  }

  const index = Number(argument);
  if (!Number.isInteger(index) || index < 1 || index > spaces.length) {
    await botCtx.reply(
      [`That's not one of your spaces.`, '', await describeSpaces(ctx, user, spaces)].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const target = spaces[index - 1] as Household;
  try {
    await householdsRepo.switchActive(ctx.db, user.id, target.id);
  } catch (error) {
    if (error instanceof JoinHouseholdError) {
      await botCtx.reply("That space isn't available anymore.");
      return;
    }
    throw error;
  }

  await botCtx.reply(
    `Switched to *${escape(await labelFor(ctx, user, target))}*. \`/today\` to see it.`,
    {
      parse_mode: 'Markdown',
      reply_markup: openAppKeyboard(ctx.config),
    },
  );
}
