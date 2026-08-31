import type { JSX } from 'react';
import type { RecapPeriod, RecapResponse } from '@spendlygo/shared';
import { formatMoney, formatShortDate } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface RecapCardProps {
  data: RecapResponse | undefined;
  loading: boolean;
  period: RecapPeriod;
  onChangePeriod: (period: RecapPeriod) => void;
  currency: string;
  locale: string;
}

/**
 * A shareable, screenshot-able wrap-up (PRD-adjacent) — distinct in tone from
 * the plain data of the Stats screen. No image is generated server-side
 * (GUARDRAILS.md section 7 bans that kind of runtime weight); this screen
 * itself, styled to be worth a screenshot, is the "share" mechanism.
 */
export function RecapCard({
  data,
  loading,
  period,
  onChangePeriod,
  currency,
  locale,
}: RecapCardProps): JSX.Element {
  const money = (cents: number) => formatMoney(cents, { currency, locale, hideZeroCents: true });

  return (
    <div className="recap">
      <div className="seg" role="tablist" aria-label="Recap period">
        {(['month', 'year'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={period === option}
            className={`seg__option ${period === option ? 'seg__option--on' : ''}`}
            onClick={() => {
              haptics.select();
              onChangePeriod(option);
            }}
          >
            {option === 'month' ? 'This month' : 'This year'}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="card">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton skeleton--short" />
        </div>
      ) : !data || data.outCents === 0 ? (
        <div className="empty empty--inline">
          <div className="empty__emoji">🎉</div>
          <p className="empty__body">Nothing logged for {data?.label ?? 'this period'} yet.</p>
        </div>
      ) : (
        <div className="recap__card">
          <div className="recap__heading">{data.label}</div>
          <div className="recap__hero">{money(data.outCents)}</div>
          <div className="recap__caption">spent</div>

          {data.deltaPct !== null && (
            <div className="recap__delta">
              {data.deltaPct === 0
                ? 'Same as the period before'
                : `${Math.abs(data.deltaPct)}% ${data.deltaPct > 0 ? 'more' : 'less'} than before`}
            </div>
          )}

          <div className="recap__grid">
            {data.topCategories[0] && (
              <div className="recap__stat">
                <span className="recap__stat-label">Top category</span>
                <span className="recap__stat-value">
                  {data.topCategories[0].emoji} {data.topCategories[0].name}
                </span>
                <span className="recap__stat-sub">{money(data.topCategories[0].outCents)}</span>
              </div>
            )}

            {data.bestDay && data.worstDay && (
              <div className="recap__stat">
                <span className="recap__stat-label">Lightest / heaviest</span>
                <span className="recap__stat-value">
                  {formatShortDate(data.bestDay.day)} · {formatShortDate(data.worstDay.day)}
                </span>
                <span className="recap__stat-sub">{money(data.worstDay.outCents)} heaviest</span>
              </div>
            )}

            {data.inCents > 0 && (
              <div className="recap__stat">
                <span className="recap__stat-label">Received</span>
                <span className="recap__stat-value recap__stat-value--in">
                  {money(data.inCents)}
                </span>
                <span className="recap__stat-sub">
                  net {formatMoney(data.netCents, { currency, locale, signed: true })}
                </span>
              </div>
            )}

            {data.streak.longest >= 2 && (
              <div className="recap__stat">
                <span className="recap__stat-label">Longest streak</span>
                <span className="recap__stat-value">🔥 {data.streak.longest} days</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
