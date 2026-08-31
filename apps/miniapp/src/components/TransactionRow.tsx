import type { JSX } from 'react';
import type { Transaction } from '@spendlygo/shared';
import { formatMoney } from '../lib/format';

export interface TransactionRowProps {
  transaction: Transaction;
  currency: string;
  locale: string;
  onSelect?: (transaction: Transaction) => void;
  index?: number;
}

export function TransactionRow({
  transaction,
  currency,
  locale,
  onSelect,
  index = 0,
}: TransactionRowProps): JSX.Element {
  const isIncome = transaction.direction === 'in';
  const label = transaction.note ?? transaction.categoryName ?? 'Uncategorised';

  return (
    <button
      type="button"
      className="txn"
      // Rows stagger in at 30ms intervals (DESIGN.md section 5.2), capped so a
      // long list does not take a visible age to appear.
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
      onClick={() => onSelect?.(transaction)}
    >
      <span className="txn__emoji" aria-hidden="true">
        {transaction.categoryEmoji ?? '•'}
      </span>
      <span className="txn__body">
        <span className="txn__label">{label}</span>
        <span className="txn__meta">
          {transaction.categoryName ?? 'Uncategorised'}
          {transaction.source === 'recurring' && ' · repeating'}
          {/* Only ever true inside a shared household — a solo transaction is
              always the viewer's own. This is the whole point of sharing:
              seeing what your partner logged, not just a combined total. */}
          {!transaction.isOwn && ` · ${transaction.authorName}`}
        </span>
      </span>
      <span className={`txn__amount ${isIncome ? 'txn__amount--in' : ''}`}>
        {isIncome ? '+' : '−'}
        {formatMoney(transaction.amountCents, { currency, locale })}
      </span>
    </button>
  );
}
