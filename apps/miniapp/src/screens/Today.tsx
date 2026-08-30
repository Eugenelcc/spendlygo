import type { JSX } from 'react';
import type { TodayResponse, Transaction } from '@spendlygo/shared';
import { Ring } from '../components/Ring';
import { HeroAmount } from '../components/Money';
import { Sparkline } from '../components/Sparkline';
import { TransactionRow } from '../components/TransactionRow';
import { formatLongDate, formatMoney, PACE_COPY } from '../lib/format';

export interface TodayScreenProps {
  data: TodayResponse;
  onSelectTransaction: (transaction: Transaction) => void;
  onSetBudget: () => void;
}

/**
 * The screen that justifies the app (DESIGN.md section 7.1).
 *
 * One number, answered before anything else: how much can I spend today.
 */
export function TodayScreen({
  data,
  onSelectTransaction,
  onSetBudget,
}: TodayScreenProps): JSX.Element {
  const { safeToSpend: sts, currency, locale } = data;
  const money = (cents: number) => formatMoney(cents, { currency, locale });
  const pace = PACE_COPY[sts.pace] ?? PACE_COPY.on_track;

  const tone = !sts.hasBudget
    ? 'idle'
    : sts.pace === 'over_budget'
      ? 'over'
      : sts.pace === 'behind'
        ? 'behind'
        : sts.pace === 'ahead'
          ? 'ahead'
          : 'ontrack';

  // The ring shows today's allowance being used up, not the whole month — it
  // is a today screen, and a month-scale ring barely moves after one coffee.
  const usedToday =
    sts.safeTodayCents > 0 ? Math.min(1, sts.spentTodayCents / sts.safeTodayCents) : 1;

  return (
    <div className="screen">
      <p className="date">{formatLongDate(data.today)}</p>

      {sts.hasBudget ? (
        <>
          <div className="hero">
            <Ring
              progress={usedToday}
              tone={tone}
              label={`${money(sts.leftForTodayCents)} left to spend today`}
            >
              <HeroAmount cents={sts.leftForTodayCents} currency={currency} locale={locale} />
              <span className="hero__caption">
                {sts.overspentCents > 0 ? 'over budget' : 'left today'}
              </span>
            </Ring>
          </div>

          <div className="statline">
            <span className={`pill pill--${pace?.token}`}>
              <span className="pill__dot" aria-hidden="true" />
              {pace?.label}
            </span>
            <span className="statline__spent">{money(sts.spentTodayCents)} spent today</span>
          </div>

          <section className="card">
            <div className="card__head">
              <span className="card__label">This month</span>
              <span className="card__value">
                {money(sts.spentMonthToDateCents)}
                <span className="card__of"> of {money(sts.budgetCents ?? 0)}</span>
              </span>
            </div>
            <div className="meter">
              <div
                className={`meter__fill meter__fill--${tone}`}
                style={{ width: `${Math.round(sts.budgetUsedRatio * 100)}%` }}
              />
            </div>
            <div className="card__foot">
              <span>
                {sts.daysRemaining} {sts.daysRemaining === 1 ? 'day' : 'days'} left
              </span>
              <span>
                {sts.overspentCents > 0
                  ? `${money(sts.overspentCents)} over`
                  : `${money(sts.remainingCents)} remaining`}
              </span>
            </div>
          </section>
        </>
      ) : (
        <section className="card card--invite">
          <div className="card__label">No budget yet</div>
          <p className="card__prose">
            Set a monthly budget and I'll work out what's safe to spend each day — one number that
            updates as you go.
          </p>
          <button type="button" className="primary primary--inline" onClick={onSetBudget}>
            Set a monthly budget
          </button>
          <div className="card__foot card__foot--tight">
            <span>{money(sts.spentTodayCents)} spent today</span>
            <span>{money(sts.spentMonthToDateCents)} this month</span>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card__head">
          <span className="card__label">Last 7 days</span>
          <span className="card__value card__value--sm">
            {money(data.recentDays.reduce((sum, day) => sum + day.outCents, 0))}
          </span>
        </div>
        <Sparkline
          values={data.recentDays.map((day) => day.outCents)}
          label={`Spending over the last 7 days, ending today at ${money(sts.spentTodayCents)}`}
        />
      </section>

      <section>
        <h2 className="section-title">Today</h2>
        {data.transactions.length === 0 ? (
          <div className="empty empty--inline">
            <div className="empty__emoji">🌤️</div>
            <p className="empty__body">Nothing logged today yet.</p>
          </div>
        ) : (
          <div className="list">
            {data.transactions.map((transaction, index) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                currency={currency}
                locale={locale}
                index={index}
                onSelect={onSelectTransaction}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
