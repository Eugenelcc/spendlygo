import type { JSX } from 'react';
import { formatMoney } from '../lib/format';

export interface BarChartProps {
  data: Array<{ key: string; label: string; outCents: number }>;
  currency: string;
  locale: string;
  /** Highlight one bucket — today, or the current month. */
  highlightKey?: string;
}

/**
 * Hand-written SVG-free bar chart (GUARDRAILS.md section 8).
 *
 * Plain divs with a height percentage: no library, and the browser animates it
 * for free. Only every Nth label is drawn so a 31-day month stays legible.
 */
export function BarChart({ data, currency, locale, highlightKey }: BarChartProps): JSX.Element {
  const max = Math.max(1, ...data.map((point) => point.outCents));
  const labelEvery = data.length > 15 ? 5 : data.length > 8 ? 2 : 1;
  const total = data.reduce((sum, point) => sum + point.outCents, 0);

  return (
    <div
      className="bars"
      role="img"
      aria-label={`Spending by period, total ${formatMoney(total, { currency, locale })}`}
    >
      <div className="bars__plot">
        {data.map((point, index) => (
          <div className="bars__slot" key={point.key} title={`${point.label}`}>
            <div
              className={`bars__bar ${point.key === highlightKey ? 'bars__bar--now' : ''} ${
                point.outCents === 0 ? 'bars__bar--empty' : ''
              }`}
              style={{
                height: `${(point.outCents / max) * 100}%`,
                animationDelay: `${Math.min(index, 20) * 25}ms`,
              }}
            />
            <span className="bars__label">
              {index % labelEvery === 0 || point.key === highlightKey ? point.label : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
