import type { JSX } from 'react';
import { formatMoney } from '../lib/format';

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
}

const SIZE = 176;
const STROKE = 28;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A donut chart of spending by category — total in the middle, a coloured
 * ring split into one arc per category, legend below. Hand-written SVG, the
 * same stroke-dasharray technique as Ring, just one arc per slice instead of
 * one continuous sweep (GUARDRAILS.md section 8: no charting library).
 */
export function CategoryDonut({ data, currency, locale }: CategoryDonutProps): JSX.Element | null {
  const sorted = [...data]
    .filter((slice) => slice.outCents > 0)
    .sort((a, b) => b.outCents - a.outCents);
  const total = sorted.reduce((sum, slice) => sum + slice.outCents, 0);
  if (total <= 0) return null;

  let drawnSoFar = 0;
  const arcs = sorted.map((slice) => {
    const length = (slice.outCents / total) * CIRCUMFERENCE;
    const arc = { ...slice, length, offset: -drawnSoFar };
    drawnSoFar += length;
    return arc;
  });

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
              key={arc.categoryId ?? arc.name}
              className={`donut__segment donut__segment--${arc.colorToken}`}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
              strokeDashoffset={arc.offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
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
          <div className="donut__legend-row" key={arc.categoryId ?? arc.name}>
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
          </div>
        ))}
      </div>
    </div>
  );
}
