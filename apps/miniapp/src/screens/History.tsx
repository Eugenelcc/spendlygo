import { useMemo, useState, type JSX } from 'react';
import type { Transaction } from '@spendlygo/shared';
import { TransactionRow } from '../components/TransactionRow';
import { formatMoney, formatRelativeDate } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface HistoryScreenProps {
  transactions: Transaction[];
  loading: boolean;
  currency: string;
  locale: string;
  today: string;
  onSelect: (transaction: Transaction) => void;
}

interface CategoryOption {
  slug: string;
  name: string;
  emoji: string;
}

/** Grouped by day with the day's net at the head, so the list scans. Search
 * and the category chips filter what's already loaded — PRD-adjacent, no
 * extra round trip since History already fetches a generous window. */
export function HistoryScreen({
  transactions,
  loading,
  currency,
  locale,
  today,
  onSelect,
}: HistoryScreenProps): JSX.Element {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const categoryOptions = useMemo<CategoryOption[]>(() => {
    const bySlug = new Map<string, CategoryOption>();
    for (const transaction of transactions) {
      if (!transaction.categorySlug) continue;
      if (!bySlug.has(transaction.categorySlug)) {
        bySlug.set(transaction.categorySlug, {
          slug: transaction.categorySlug,
          name: transaction.categoryName ?? transaction.categorySlug,
          emoji: transaction.categoryEmoji ?? '•',
        });
      }
    }
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [transactions]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactions.filter((transaction) => {
      if (categoryFilter && transaction.categorySlug !== categoryFilter) return false;
      if (!query) return true;
      const haystack = `${transaction.note ?? ''} ${transaction.categoryName ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [transactions, search, categoryFilter]);

  const groups = new Map<string, Transaction[]>();
  for (const transaction of filtered) {
    const bucket = groups.get(transaction.occurredOn) ?? [];
    bucket.push(transaction);
    groups.set(transaction.occurredOn, bucket);
  }

  const filtering = search.trim() !== '' || categoryFilter !== null;

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
      <div className="search-bar">
        <span className="search-bar__icon" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          inputMode="search"
          className="search-bar__input"
          placeholder="Search notes or categories"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search your history"
        />
        {search !== '' && (
          <button
            type="button"
            className="search-bar__clear"
            aria-label="Clear search"
            onClick={() => {
              haptics.tap();
              setSearch('');
            }}
          >
            ×
          </button>
        )}
      </div>

      {categoryOptions.length > 1 && (
        <div className="chip-row" role="group" aria-label="Filter by category">
          <button
            type="button"
            className={`chip ${categoryFilter === null ? 'chip--on' : ''}`}
            onClick={() => {
              haptics.select();
              setCategoryFilter(null);
            }}
          >
            All
          </button>
          {categoryOptions.map((category) => (
            <button
              type="button"
              key={category.slug}
              className={`chip ${categoryFilter === category.slug ? 'chip--on' : ''}`}
              onClick={() => {
                haptics.select();
                setCategoryFilter(categoryFilter === category.slug ? null : category.slug);
              }}
            >
              {category.emoji} {category.name}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty empty--inline">
          <div className="empty__emoji">🔍</div>
          <p className="empty__body">
            {filtering ? 'Nothing matches that.' : 'Nothing logged yet.'}
          </p>
        </div>
      ) : (
        [...groups.entries()].map(([day, rows]) => {
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
        })
      )}
    </div>
  );
}
