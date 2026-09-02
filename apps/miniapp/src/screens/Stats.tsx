import type { JSX } from 'react';
import type { HeatmapResponse, StatsPeriod, StatsResponse, Transaction } from '@spendlygo/shared';
import { BarChart } from '../components/BarChart';
import { CalendarHeatmap } from '../components/CalendarHeatmap';
import { CategoryDonut } from '../components/CategoryDonut';
import { LineChart } from '../components/LineChart';
import { formatMoney } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface StatsScreenProps {
  period: StatsPeriod;
  onPeriodChange: (period: StatsPeriod) => void;
  data: StatsResponse | undefined;
  loading: boolean;
  heatmap: HeatmapResponse | undefined;
  currency: string;
  locale: string;
  today: string;
  onOpenRecap: () => void;
  selectedCategoryKey: string | null;
  onSelectCategoryKey: (key: string | null) => void;
  selectedCategoryTransactions: Transaction[] | undefined;
  selectedCategoryLoading: boolean;
  onSelectTransaction: (transaction: Transaction) => void;
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
  heatmap,
  currency,
  locale,
  today,
  onOpenRecap,
  selectedCategoryKey,
  onSelectCategoryKey,
  selectedCategoryTransactions,
  selectedCategoryLoading,
  onSelectTransaction,
}: StatsScreenProps): JSX.Element {
  const money = (cents: number) => formatMoney(cents, { currency, locale });

  const highlightKey =
    period === 'year' ? today.slice(0, 7) : period === 'month' ? today : undefined;

  const delta =
    data && data.previousOutCents > 0
      ? Math.round(((data.outCents - data.previousOutCents) / data.previousOutCents) * 100)
      : null;

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

      <section className="card">
        <div className="card__label">Last year at a glance</div>
        {heatmap ? (
          <CalendarHeatmap days={heatmap.days} currency={currency} locale={locale} />
        ) : (
          <div className="skeleton skeleton--short" />
        )}
      </section>

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
              <CategoryDonut
                data={data.byCategory}
                currency={currency}
                locale={locale}
                selectedKey={selectedCategoryKey}
                onSelectKey={onSelectCategoryKey}
                selectedTransactions={selectedCategoryTransactions}
                selectedLoading={selectedCategoryLoading}
                onSelectTransaction={onSelectTransaction}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
