import { useState, type JSX } from 'react';
import { formatMoney, formatRelativeDate } from '../lib/format';
import { haptics } from '../lib/telegram';

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
}

/** Seven tappable bars — tap one to see that day's date and what was spent. */
export function Sparkline({ days, today, currency, locale, label }: SparklineProps): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((entry) => entry.outCents));
  const active = selected === null ? null : (days[selected] ?? null);

  return (
    <div className="spark-wrap">
      <div className="spark" role="img" aria-label={label}>
        {days.map((entry, index) => (
          <button
            type="button"
            key={entry.day}
            className={`spark__bar ${index === days.length - 1 ? 'spark__bar--now' : ''} ${
              selected === index ? 'spark__bar--on' : ''
            }`}
            style={{ height: `${Math.max(6, (entry.outCents / max) * 100)}%` }}
            aria-pressed={selected === index}
            aria-label={`${formatRelativeDate(entry.day, today)}: ${formatMoney(entry.outCents, { currency, locale })}`}
            onClick={() => {
              haptics.tap();
              setSelected((current) => (current === index ? null : index));
            }}
          />
        ))}
      </div>
      {active && (
        <p className="spark__detail">
          <span className="spark__detail-day">{formatRelativeDate(active.day, today)}</span>
          <span className="spark__detail-amount">
            {formatMoney(active.outCents, { currency, locale })}
          </span>
        </p>
      )}
    </div>
  );
}
