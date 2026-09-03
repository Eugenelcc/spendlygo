import type { JSX, KeyboardEvent } from 'react';
import type { Transaction } from '@spendlygo/shared';
import { formatMoney } from '../lib/format';
import { haptics } from '../lib/telegram';
import { TransactionRow } from './TransactionRow';

export interface CategoryDonutSlice {
  categoryId: string | null;
  name: string;
  emoji: string;
  colorToken: string;
  outCents: number;
  count: number;
}

export interface CategoryDonutProps {
  data: CategoryDonutSlice[];
  currency: string;
  locale: string;
  /** A slice's selection key — its `categoryId`, or `"none"` for the
   * Uncategorised slice, matching the API's own filter sentinel
   * (packages/db/src/repositories/transactions.ts). Null when nothing's
   * tapped. */
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
  selectedTransactions: Transaction[] | undefined;
  selectedLoading: boolean;
  onSelectTransaction: (transaction: Transaction) => void;
}

const SIZE = 176;
const STROKE = 28;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A slice's own key — see `CategoryDonutProps.selectedKey`. */
function keyFor(slice: Pick<CategoryDonutSlice, 'categoryId'>): string {
  return slice.categoryId ?? 'none';
}

/**
 * A donut chart of spending by category — total in the middle, a coloured
 * ring split into one arc per category, legend below. Hand-written SVG, the
 * same stroke-dasharray technique as Ring, just one arc per slice instead of
 * one continuous sweep (GUARDRAILS.md section 8: no charting library).
 *
 * Tapping a wedge or its legend row selects that category — the parent loads
 * and shows its transactions for the period, same drill-down pattern as the
 * Sparkline and calendar heatmap.
 */
export function CategoryDonut({
  data,
  currency,
  locale,
  selectedKey,
  onSelectKey,
  selectedTransactions,
  selectedLoading,
  onSelectTransaction,
}: CategoryDonutProps): JSX.Element | null {
  const sorted = [...data]
    .filter((slice) => slice.outCents > 0)
    .sort((a, b) => b.outCents - a.outCents);
  const total = sorted.reduce((sum, slice) => sum + slice.outCents, 0);
  if (total <= 0) return null;

  let drawnSoFar = 0;
  const arcs = sorted.map((slice) => {
    const length = (slice.outCents / total) * CIRCUMFERENCE;
    const arc = { ...slice, key: keyFor(slice), length, offset: -drawnSoFar };
    drawnSoFar += length;
    return arc;
  });

  const selected = arcs.find((arc) => arc.key === selectedKey) ?? null;

  const select = (key: string) => {
    haptics.select();
    onSelectKey(selectedKey === key ? null : key);
  };

  const onSegmentKeyDown = (event: KeyboardEvent<SVGCircleElement>, key: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    select(key);
  };

  return (
    <div className="donut">
      <div className="donut__chart">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Spending by category, total ${formatMoney(total, { currency, locale })}`}
        >
          <circle
            className="donut__track"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            strokeWidth={STROKE}
            fill="none"
          />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              className={`donut__segment donut__segment--${arc.colorToken} ${
                selectedKey && selectedKey !== arc.key ? 'donut__segment--dim' : ''
              }`}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
              strokeDashoffset={arc.offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              role="button"
              tabIndex={0}
              aria-label={`${arc.name}, ${formatMoney(arc.outCents, { currency, locale })}`}
              aria-pressed={selectedKey === arc.key}
              onClick={() => select(arc.key)}
              onKeyDown={(event) => onSegmentKeyDown(event, arc.key)}
            />
          ))}
        </svg>
        <div className="donut__center">
          <span className="donut__total">
            {formatMoney(total, { currency, locale, hideZeroCents: true })}
          </span>
          <span className="donut__caption">total spent</span>
        </div>
      </div>

      <div className="donut__legend">
        {arcs.map((arc) => (
          <button
            type="button"
            className={`donut__legend-row ${selectedKey === arc.key ? 'donut__legend-row--on' : ''}`}
            key={arc.key}
            aria-pressed={selectedKey === arc.key}
            onClick={() => select(arc.key)}
          >
            <span className={`donut__dot donut__dot--${arc.colorToken}`} aria-hidden="true" />
            <span className="donut__legend-name">
              {arc.emoji} {arc.name}
              <span className="donut__legend-count">
                {arc.count} {arc.count === 1 ? 'entry' : 'entries'}
              </span>
            </span>
            <span className="donut__legend-pct">{Math.round((arc.outCents / total) * 100)}%</span>
            <span className="donut__legend-amount">
              {formatMoney(arc.outCents, { currency, locale, hideZeroCents: true })}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="donut__detail">
          {selectedLoading ? (
            <div className="skeleton skeleton--short" />
          ) : !selectedTransactions || selectedTransactions.length === 0 ? (
            <p className="empty__body">Nothing logged in {selected.name} this period.</p>
          ) : (
            <div className="list">
              {selectedTransactions.map((transaction, index) => (
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
