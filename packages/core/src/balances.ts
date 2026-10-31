/**
 * Who-owes-who for a shared space (PRD-adjacent).
 *
 * Pure domain logic, no I/O — the repository aggregates `paidCents` and
 * `owedCents` per member in SQL (GUARDRAILS.md section 3) and hands the net
 * figures here. This module only does the debt-simplification arithmetic:
 * turning N members' net positions into the fewest transfers that settle
 * everyone up, the standard greedy "largest creditor meets largest debtor"
 * algorithm. For the common 2-member household this collapses to exactly
 * one line; it stays correct for more members too.
 */

import { centsOf, type AmountCents } from './money.js';

export interface MemberBalance {
  userId: string;
  /** Sum of this member's own-logged, split expenses — a raw repository
   * aggregate (packages/db/src/repositories/transactions.ts#balancesFor),
   * not yet branded, same convention as savings.ts's netContributedCents. */
  paidCents: number;
  /** Sum of this member's share across every split expense in the space. */
  owedCents: number;
}

export interface MemberNet extends MemberBalance {
  /** paidCents - owedCents. Positive: the household owes them. Negative: they owe. */
  netCents: AmountCents;
}

export interface Settlement {
  fromUserId: string;
  toUserId: string;
  amountCents: AmountCents;
}

export function netBalances(balances: MemberBalance[]): MemberNet[] {
  return balances.map((b) => ({ ...b, netCents: centsOf(b.paidCents - b.owedCents) }));
}

/**
 * The fewest transfers that zero out every member's net position. Never
 * invents a transfer smaller than 1 cent, and never leaves a cent
 * unaccounted for — every debtor's amount is matched exactly against
 * creditors before moving to the next one.
 */
export function simplifyBalances(balances: MemberBalance[]): Settlement[] {
  const nets = netBalances(balances);

  const debtors = nets
    .filter((b) => b.netCents < 0)
    .map((b) => ({ userId: b.userId, remaining: -b.netCents as number }))
    .sort((a, b) => b.remaining - a.remaining);
  const creditors = nets
    .filter((b) => b.netCents > 0)
    .map((b) => ({ userId: b.userId, remaining: b.netCents as number }))
    .sort((a, b) => b.remaining - a.remaining);

  const settlements: Settlement[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    if (!debtor || !creditor) break;

    const amount = Math.min(debtor.remaining, creditor.remaining);
    if (amount > 0) {
      settlements.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountCents: amount as AmountCents,
      });
    }

    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0) i += 1;
    if (creditor.remaining === 0) j += 1;
  }

  return settlements;
}
