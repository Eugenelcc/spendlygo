/**
 * Shared budgets (PRD-adjacent feature): /household, /invite, /join, /leave.
 *
 * GUARDRAILS.md section 4: an invite code carries no authority beyond "which
 * household to join" — the caller's identity always comes from the verified
 * Telegram update, never from anything in the invite itself. And GUARDRAILS
 * section 4's allowlist still applies: a partner has to be added to
 * ALLOWED_TELEGRAM_IDS before they can reach /join at all.
 */

import { formatCents, type AmountCents } from '@spendlygo/core';
import { householdsRepo, JoinHouseholdError } from '@spendlygo/db';
import type { AppContext } from '../../context.js';
import { escapeMarkdown as escape } from '../markdown.js';
import type { BotContext } from '../middleware.js';

const JOIN_FAILURE_MESSAGE: Record<string, string> = {
  not_found: "That code doesn't match an invite. Double-check it, or ask for a fresh one.",
  expired:
    'That invite has expired — invites last 24 hours. Ask for a new one with `/household invite`.',
  already_used: 'That invite has already been used.',
  already_in_household: "You're already sharing a budget. Leave it first with `/household leave`.",
  own_invite: "That's your own invite code — send it to your partner instead.",
};

export async function handleHousehold(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const argument = botCtx.match?.toString().trim().toLowerCase() ?? '';

  if (argument === 'invite') {
    await handleInvite(ctx, botCtx);
    return;
  }
  if (argument === 'leave') {
    await handleLeave(ctx, botCtx);
    return;
  }

  if (user.householdId === null) {
    await botCtx.reply(
      [
        "You're tracking solo — safe-to-spend is just yours.",
        '',
        'Share a budget with a partner: `/household invite` gives you a code to send them.',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const members = await householdsRepo.membersOf(ctx.db, user.householdId);
  const names = members.map((member) =>
    member.id === user.id ? 'you' : escape(member.firstName ?? 'a partner'),
  );

  await botCtx.reply(
    [
      `*Shared budget* — ${names.join(' and ')}`,
      '',
      'Both of you see every entry either of you logs, and either of you can change the budget with `/budget`.',
      '',
      '`/household invite` — add another person',
      '`/household leave` — stop sharing',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

async function handleInvite(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;

  const householdId = user.householdId ?? (await householdsRepo.create(ctx.db, user.id)).id;
  const invite = await householdsRepo.createInvite(ctx.db, householdId, user.id);

  await botCtx.reply(
    [
      "Send your partner this — it's valid for 24 hours:",
      '',
      `\`/join ${invite.code}\``,
      '',
      "They'll need to message this bot first (and be on its allowlist) before that works.",
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

async function handleLeave(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;

  if (user.householdId === null) {
    await botCtx.reply("You're not sharing a budget with anyone.");
    return;
  }

  await householdsRepo.leave(ctx.db, user.id);
  await botCtx.reply(
    "You're back to tracking solo. Your own budget is whatever it was before you shared one — check with `/budget`.",
  );
}

export async function handleJoin(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const code = botCtx.match?.toString().trim();

  if (!code) {
    await botCtx.reply('Usage: `/join CODE` — the code your partner sent you.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  try {
    const household = await householdsRepo.joinByCode(ctx.db, code, user.id);
    const members = await householdsRepo.membersOf(ctx.db, household.id);
    const others = members.filter((member) => member.id !== user.id);
    const names = others.map((member) => escape(member.firstName ?? 'them')).join(', ');

    const money = (cents: number | null) =>
      cents === null
        ? 'not set yet'
        : escape(
            formatCents(cents as AmountCents, { currency: user.currency, locale: user.locale }),
          );

    await botCtx.reply(
      [
        `You're now sharing a budget with ${names || 'your partner'}.`,
        '',
        `Monthly budget: *${money(household.monthlyBudgetCents)}*`,
        '',
        'Send `/today` to see it.',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  } catch (error) {
    if (error instanceof JoinHouseholdError) {
      await botCtx.reply(JOIN_FAILURE_MESSAGE[error.reason] ?? 'Could not join that household.');
      return;
    }
    throw error;
  }
}
