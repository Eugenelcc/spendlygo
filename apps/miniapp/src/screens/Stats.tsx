import { useState, type JSX } from 'react';
import type { StatsPeriod, StatsResponse } from '@spendlygo/shared';
import { BarChart } from '../components/BarChart';
import { LineChart } from '../components/LineChart';
import { formatMoney } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface StatsScreenProps {
  period: StatsPeriod;
  onPeriodChange: (period: StatsPeriod) => void;
  data: StatsResponse | undefined;
  loading: boolean;
  currency: string;
  locale: string;
  today: string;
  onOpenRecap: () => void;
}

const PERIODS: Array<{ value: StatsPeriod; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export function StatsScreen({
  period,
  onPeriodChange,
  data,
  loading,
  currency,
  locale,
  today,
  onOpenRecap,
}: StatsScreenProps): JSX.Element {
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const money = (cents: number) => formatMoney(cents, { currency, locale });

  const highlightKey =
    period === 'year' ? today.slice(0, 7) : period === 'month' ? today : undefined;

  const delta =
    data && data.previousOutCents > 0
      ? Math.round(((data.outCents - data.previousOutCents) / data.previousOutCents) * 100)
      : null;

  const categoryTotal = data?.byCategory.reduce((sum, row) => sum + row.outCents, 0) ?? 0;

  return (
    <div className="screen">
      <div className="seg" role="tablist" aria-label="Period">
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={period === option.value}
            className={`seg__option ${period === option.value ? 'seg__option--on' : ''}`}
            onClick={() => {
              haptics.select();
              onPeriodChange(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="card">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton skeleton--short" />
        </div>
      ) : !data ? null : (
        <>
          <section className="card">
            <div className="card__label">{data.label}</div>
            <div className="totals">
              <div className="totals__cell">
                <span className="totals__key">Spent</span>
                <span className="totals__value">{money(data.outCents)}</span>
              </div>
              <div className="totals__cell">
                <span className="totals__key">Received</span>
                <span className="totals__value totals__value--in">{money(data.inCents)}</span>
              </div>
              <div className="totals__cell">
                <span className="totals__key">Net</span>
                <span className={`totals__value ${data.netCents >= 0 ? 'totals__value--in' : ''}`}>
                  {formatMoney(data.netCents, { currency, locale, signed: true })}
                </span>
              </div>
            </div>
            {delta !== null && period !== 'day' && (
              <p className="card__foot card__foot--tight">
                <span>
                  {delta === 0
                    ? 'Same as the period before'
                    : `${Math.abs(delta)}% ${delta > 0 ? 'more' : 'less'} than the period before`}
                </span>
              </p>
            )}
            {period !== 'day' && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  haptics.tap();
                  onOpenRecap();
                }}
              >
                🎉 Share recap
              </button>
            )}
          </section>

          {period !== 'day' && (
            <section className="card">
              <div className="card__label">{period === 'year' ? 'By month' : 'By day'}</div>
              <BarChart
                data={data.series}
                currency={currency}
                locale={locale}
                highlightKey={highlightKey}
              />
            </section>
          )}

          {period !== 'day' && (
            <section className="card">
              <LineChart data={data.series} currency={currency} locale={locale} />
            </section>
          )}

          <section className="card">
            <div className="card__label">Where it went</div>
            {data.byCategory.length === 0 ? (
              <p className="empty__body">Nothing spent in this period.</p>
            ) : (
              <div className="catlist">
                {data.byCategory.map((row) => {
                  const share = categoryTotal > 0 ? row.outCents / categoryTotal : 0;
                  const id = row.categoryId ?? 'none';
                  return (
                    <button
                      type="button"
                      className="cat"
                      key={id}
                      aria-expanded={openCategory === id}
                      onClick={() => {
                        haptics.tap();
                        setOpenCategory(openCategory === id ? null : id);
                      }}
                    >
                      <span className="cat__emoji" aria-hidden="true">
                        {row.emoji}
                      </span>
                      <span className="cat__body">
                        <span className="cat__top">
                          <span className="cat__name">{row.name}</span>
                          <span className="cat__amount">{money(row.outCents)}</span>
                        </span>
                        <span className="cat__meter">
                          <span
                            className={`cat__fill cat__fill--${row.colorToken}`}
                            style={{ width: `${Math.max(2, share * 100)}%` }}
                          />
                        </span>
                        {openCategory === id && (
                          <span className="cat__detail">
                            {Math.round(share * 100)}% of spending · {row.count}{' '}
                            {row.count === 1 ? 'entry' : 'entries'}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
