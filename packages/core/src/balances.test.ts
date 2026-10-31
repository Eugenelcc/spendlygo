import { describe, expect, it } from 'vitest';
import { centsOf } from './money.js';
import { netBalances, simplifyBalances, type MemberBalance } from './balances.js';

const dollars = (value: number) => centsOf(Math.round(value * 100));

describe('netBalances', () => {
  it('is zero when everyone paid exactly their share', () => {
    const result = netBalances([{ userId: 'a', paidCents: dollars(50), owedCents: dollars(50) }]);
    expect(result[0]?.netCents).toBe(0);
  });

  it('is positive when a member paid more than their share', () => {
    const result = netBalances([{ userId: 'a', paidCents: dollars(100), owedCents: dollars(50) }]);
    expect(result[0]?.netCents).toBe(dollars(50));
  });

  it('is negative when a member paid less than their share', () => {
    const result = netBalances([{ userId: 'a', paidCents: dollars(0), owedCents: dollars(50) }]);
    expect(result[0]?.netCents).toBe(-dollars(50));
  });
});

describe('simplifyBalances', () => {
  it('settles the common two-person case with one transfer', () => {
    // Alex paid $100 for a $100 bill split evenly; Bo owes $50.
    const balances: MemberBalance[] = [
      { userId: 'alex', paidCents: dollars(100), owedCents: dollars(50) },
      { userId: 'bo', paidCents: dollars(0), owedCents: dollars(50) },
    ];
    expect(simplifyBalances(balances)).toEqual([
      { fromUserId: 'bo', toUserId: 'alex', amountCents: dollars(50) },
    ]);
  });

  it('produces no settlements once everyone is square', () => {
    const balances: MemberBalance[] = [
      { userId: 'alex', paidCents: dollars(50), owedCents: dollars(50) },
      { userId: 'bo', paidCents: dollars(50), owedCents: dollars(50) },
    ];
    expect(simplifyBalances(balances)).toEqual([]);
  });

  it('nets out several transactions into one running balance', () => {
    // Alex paid $100 (owes $50), then Bo paid $30 (owes $15): net, Bo still
    // owes Alex $35, not two separate settlements.
    const balances: MemberBalance[] = [
      { userId: 'alex', paidCents: dollars(100), owedCents: dollars(65) },
      { userId: 'bo', paidCents: dollars(30), owedCents: dollars(65) },
    ];
    expect(simplifyBalances(balances)).toEqual([
      { fromUserId: 'bo', toUserId: 'alex', amountCents: dollars(35) },
    ]);
  });

  it('settles three members with the fewest transfers, matching largest to largest', () => {
    // Alex is owed $60, Bo is owed $10, Cat owes $70.
    const balances: MemberBalance[] = [
      { userId: 'alex', paidCents: dollars(60), owedCents: dollars(0) },
      { userId: 'bo', paidCents: dollars(10), owedCents: dollars(0) },
      { userId: 'cat', paidCents: dollars(0), owedCents: dollars(70) },
    ];
    expect(simplifyBalances(balances)).toEqual([
      { fromUserId: 'cat', toUserId: 'alex', amountCents: dollars(60) },
      { fromUserId: 'cat', toUserId: 'bo', amountCents: dollars(10) },
    ]);
  });

  it('never leaves a fractional cent unsettled', () => {
    const balances: MemberBalance[] = [
      { userId: 'alex', paidCents: centsOf(101), owedCents: centsOf(0) },
      { userId: 'bo', paidCents: centsOf(0), owedCents: centsOf(101) },
    ];
    const total = simplifyBalances(balances).reduce((sum, s) => sum + s.amountCents, 0);
    expect(total).toBe(101);
  });

  it('returns nothing for a solo "household" of one', () => {
    expect(
      simplifyBalances([{ userId: 'alex', paidCents: dollars(50), owedCents: dollars(50) }]),
    ).toEqual([]);
  });
});
