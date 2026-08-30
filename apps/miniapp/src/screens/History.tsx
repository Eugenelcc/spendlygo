import type { JSX } from 'react';
import type { Transaction } from '@spendlygo/shared';
import { TransactionRow } from '../components/TransactionRow';
import { formatMoney, formatRelativeDate } from '../lib/format';

export interface HistoryScreenProps {
  transactions: Transaction[];
  loading: boolean;
  currency: string;
  locale: string;
  today: string;
  onSelect: (transaction: Transaction) => void;
}

/** Grouped by day with the day's net at the head, so the list scans. */
export function HistoryScreen({
  transactions,
  loading,
  currency,
  locale,
  today,
  onSelect,
}: HistoryScreenProps): JSX.Element {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const bucket = groups.get(transaction.occurredOn) ?? [];
    bucket.push(transaction);
    groups.set(transaction.occurredOn, bucket);
  }

  if (loading && transactions.length === 0) {
    return (
      <div className="screen">
        <div className="card">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton skeleton--short" />
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="screen">
        <div className="empty">
          <div className="empty__emoji">📖</div>
          <div className="empty__title">Nothing here yet</div>
          <p className="empty__body">
            Log something with the + button, or just type <code>12.50 lunch</code> to the bot.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      {[...groups.entries()].map(([day, rows]) => {
        const dayOut = rows
          .filter((row) => row.direction === 'out')
          .reduce((sum, row) => sum + row.amountCents, 0);

        return (
          <section key={day}>
            <div className="daybar">
              <span className="daybar__day">{formatRelativeDate(day, today)}</span>
              <span className="daybar__total">{formatMoney(dayOut, { currency, locale })}</span>
            </div>
            <div className="list">
              {rows.map((transaction, index) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  currency={currency}
                  locale={locale}
                  index={index}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
