import type { JSX } from 'react';
import type { Transaction } from '@spendlygo/shared';
import { formatMoney, formatRelativeDate } from '../lib/format';
import { haptics } from '../lib/telegram';
import { TransactionRow } from './TransactionRow';

export interface SparklineDay {
  day: string;
  outCents: number;
}

export interface SparklineProps {
  days: SparklineDay[];
  /** For "Today"/"Yesterday" labelling — see `formatRelativeDate`. */
  today: string;
  currency: string;
  locale: string;
  label: string;
  /** The tapped day, or null when the bars are collapsed — lifted to the
   * parent because opening a day fetches that day's transactions. */
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  dayTransactions: Transaction[] | undefined;
  dayTransactionsLoading: boolean;
  onSelectTransaction: (transaction: Transaction) => void;
}

/** Seven tappable bars — tap one to see that day's date, total, and what was
 * actually bought, without leaving Today for History. */
export function Sparkline({
  days,
  today,
  currency,
  locale,
  label,
  selectedDay,
  onSelectDay,
  dayTransactions,
  dayTransactionsLoading,
  onSelectTransaction,
}: SparklineProps): JSX.Element {
  const max = Math.max(1, ...days.map((entry) => entry.outCents));
  const active = days.find((entry) => entry.day === selectedDay) ?? null;

  return (
    <div className="spark-wrap">
      <div className="spark" role="img" aria-label={label}>
        {days.map((entry, index) => (
          <button
            type="button"
            key={entry.day}
            className={`spark__bar ${index === days.length - 1 ? 'spark__bar--now' : ''} ${
              selectedDay === entry.day ? 'spark__bar--on' : ''
            }`}
            style={{ height: `${Math.max(6, (entry.outCents / max) * 100)}%` }}
            aria-pressed={selectedDay === entry.day}
            aria-label={`${formatRelativeDate(entry.day, today)}: ${formatMoney(entry.outCents, { currency, locale })}`}
            onClick={() => {
              haptics.tap();
              onSelectDay(selectedDay === entry.day ? null : entry.day);
            }}
          />
        ))}
      </div>
      {active && (
        <div className="spark__day">
          <p className="spark__detail">
            <span className="spark__detail-day">{formatRelativeDate(active.day, today)}</span>
            <span className="spark__detail-amount">
              {formatMoney(active.outCents, { currency, locale })}
            </span>
          </p>
          {dayTransactionsLoading ? (
            <div className="skeleton skeleton--short" />
          ) : !dayTransactions || dayTransactions.length === 0 ? (
            <p className="empty__body">Nothing logged that day.</p>
          ) : (
            <div className="list">
              {dayTransactions.map((transaction, index) => (
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
        </div>
      )}
    </div>
  );
}
