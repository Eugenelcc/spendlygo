/**
 * Pure tests for the bot's /today and /budget text (B-032 Part 1, P1-AC24). No DB.
 *
 * The start-day-1 expectations are the exact strings the code on `main` produced
 * before F17, so they prove day 1 is byte-for-byte unchanged.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  calculateSafeToSpend,
  centsOf,
  cycleContaining,
  type IsoDate,
  type SafeToSpendResult,
} from '@spendlygo/core';

const mocks = vi.hoisted(() => ({ result: null as unknown, updateBudget: vi.fn() }));

vi.mock('@spendlygo/db', () => ({
  householdsRepo: {
    findById: async () => ({ isPersonal: true }),
    updateBudget: mocks.updateBudget,
  },
  transactionsRepo: {},
}));
vi.mock('../../api/service.js', () => ({
  activeHouseholdId: () => 'household-1',
  computeSafeToSpend: async () => mocks.result,
  computeStreak: async () => ({ current: 0, longest: 0 }),
  effectiveBudgetCents: async () => null,
  todayFor: () => '2026-10-31',
}));

import { buildTodayText, handleBudget } from './money.js';
import type { AppContext } from '../../context.js';
import type { BotContext } from '../middleware.js';

const TODAY = '2026-10-31' as IsoDate;
const user = { currency: 'SGD', locale: 'en-SG' };
const streak = { current: 0, longest: 0 };

function resultFor(startDay: number, budget: number | null): SafeToSpendResult {
  return calculateSafeToSpend({
    budgetCents: budget === null ? null : centsOf(budget),
    spentMonthToDateCents: centsOf(5_000),
    spentTodayCents: centsOf(0),
    today: TODAY,
    cycle: cycleContaining(TODAY, startDay),
  });
}

function textFor(startDay: number, budget: number | null = 150_000): string {
  return buildTodayText({
    user,
    today: TODAY,
    result: resultFor(startDay, budget),
    streak,
    cycle: cycleContaining(TODAY, startDay),
  });
}

async function budgetReply(startDay: number, argument: string): Promise<string> {
  mocks.result = { ...resultFor(startDay, 150_000), cycle: cycleContaining(TODAY, startDay) };
  const replies: string[] = [];
  const botCtx = {
    appUser: { ...user, activeHouseholdId: 'household-1' },
    match: argument,
    reply: async (text: string) => {
      replies.push(text);
    },
  } as unknown as BotContext;
  const ctx = { config: { miniappUrl: 'https://app.example' } } as unknown as AppContext;
  await handleBudget(ctx, botCtx);
  return replies[0] ?? '';
}

describe('/today text', () => {
  it('names the cycle range for day 20', () => {
    const day20 = textFor(20);
    expect(day20).toContain('20 Oct – 19 Nov: $50.00 of $1,500.00');
    expect(day20).not.toContain('This month');
  });

  it('day 1 with a budget is unchanged', () => {
    const day1 = textFor(1);
    expect(day1).toContain('This month: $50.00 of $1,500.00');
    expect(day1).not.toContain('20 Oct');
  });

  it('day 1 with no budget is unchanged', () => {
    expect(textFor(1, null)).toBe(
      [
        '*Today*  ·  2026-10-31',
        '',
        'Spent today: $0.00',
        'Spent this month: $50.00',
        '',
        'Set a monthly budget to see what is safe to spend:',
        '`/budget 1500`',
      ].join('\n'),
    );
  });

  it('day 20 with no budget says "this cycle"', () => {
    expect(textFor(20, null)).toContain('Spent this cycle: $50.00');
  });
});

describe('/budget text', () => {
  it('day 1 set-budget reply is unchanged', async () => {
    const text = await budgetReply(1, '1500');
    expect(text).toBe(
      [
        'Monthly budget set to *$1,500.00*.',
        '',
        'That is $1,450.00 a day for the 1 day left this month.',
      ].join('\n'),
    );
  });
});

describe('/budget', () => {
  it("records the change under today in the user's timezone", async () => {
    mocks.updateBudget.mockClear();
    const text = await budgetReply(1, '500');
    expect(mocks.updateBudget).toHaveBeenCalledTimes(1);
    expect(mocks.updateBudget).toHaveBeenCalledWith(
      expect.anything(),
      'household-1',
      50_000,
      '2026-10-31',
    );
    expect(text).toContain('Monthly budget set to *$500.00*.');
  });
});
