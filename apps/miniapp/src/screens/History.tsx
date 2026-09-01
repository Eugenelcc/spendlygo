import { useMemo, useState, type JSX } from 'react';
import type { Transaction } from '@spendlygo/shared';
import { TransactionRow } from '../components/TransactionRow';
import { formatMoney, formatRelativeDate } from '../lib/format';
import { haptics } from '../lib/telegram';

export type HistoryPeriod = 'all' | 'day' | 'week' | 'month' | 'custom';

const PERIODS: Array<{ value: HistoryPeriod; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
];

export interface HistoryScreenProps {
  transactions: Transaction[];
  loading: boolean;
  currency: string;
  locale: string;
  today: string;
  onSelect: (transaction: Transaction) => void;
  period: HistoryPeriod;
  onPeriodChange: (period: HistoryPeriod) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
}

interface CategoryOption {
  slug: string;
  name: string;
  emoji: string;
}

/** Grouped by day with the day's net at the head, so the list scans. The
 * period chips narrow the fetch itself (server-side, PRD-adjacent — no point
 * paging through hundreds of rows client-side for "last 7 days"); search and
 * the category chips then filter whatever that period's window loaded. */
export function HistoryScreen({
  transactions,
  loading,
  currency,
  locale,
  today,
  onSelect,
  period,
  onPeriodChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
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
  const customIncomplete = period === 'custom' && (!customFrom || !customTo);

  // A brand-new user with nothing logged at all, ever — the only case that
  // earns the full centered empty state; any period/filter narrowing an
  // otherwise-nonempty history gets an inline message instead, so the
  // controls that got them there stay on screen to try something else.
  if (!loading && transactions.length === 0 && period === 'all' && !filtering) {
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

      <div className="chip-row" role="group" aria-label="Filter by date">
        {PERIODS.map((option) => (
          <button
            type="button"
            key={option.value}
            className={`chip ${period === option.value ? 'chip--on' : ''}`}
            onClick={() => {
              haptics.select();
              onPeriodChange(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {period === 'custom' && (
        <div className="date-range">
          <input
            type="date"
            className="input"
            value={customFrom}
            max={customTo || today}
            aria-label="From date"
            onChange={(event) => onCustomFromChange(event.target.value)}
          />
          <span className="date-range__sep" aria-hidden="true">
            –
          </span>
          <input
            type="date"
            className="input"
            value={customTo}
            min={customFrom}
            max={today}
            aria-label="To date"
            onChange={(event) => onCustomToChange(event.target.value)}
          />
        </div>
      )}

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
            All categories
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

      {loading ? (
        <div className="card">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton skeleton--short" />
        </div>
      ) : customIncomplete ? (
        <div className="empty empty--inline">
          <div className="empty__emoji">🗓️</div>
          <p className="empty__body">Pick both a start and end date.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty empty--inline">
          <div className="empty__emoji">🔍</div>
          <p className="empty__body">
            {filtering ? 'Nothing matches that.' : 'Nothing logged in this period.'}
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
