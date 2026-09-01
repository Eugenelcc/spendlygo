import { useMemo, useState, type JSX } from 'react';
import { formatMoney, formatShortDate, isoWeekday, monthAbbrev } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface HeatmapDay {
  day: string;
  outCents: number;
}

export interface CalendarHeatmapProps {
  days: HeatmapDay[];
  currency: string;
  locale: string;
}

interface Cell {
  day: string;
  outCents: number;
  level: 0 | 1 | 2 | 3 | 4;
}

/** Quantile buckets of the days that actually had spending, not a fixed
 * cents scale — one big one-off purchase should not wash out every other
 * day's colour into "basically nothing" by comparison. */
function levelFor(outCents: number, sortedNonZero: number[]): 0 | 1 | 2 | 3 | 4 {
  if (outCents <= 0 || sortedNonZero.length === 0) return 0;
  const rank = sortedNonZero.filter((value) => value <= outCents).length / sortedNonZero.length;
  if (rank <= 0.25) return 1;
  if (rank <= 0.5) return 2;
  if (rank <= 0.75) return 3;
  return 4;
}

/**
 * A GitHub-style contribution graph, but for spending: 53 weeks ending
 * today, one cell per day, colour intensity by how much that day cost
 * relative to the rest of the window. Tap a day for its date and amount —
 * same interaction as the 7-day Sparkline.
 */
export function CalendarHeatmap({ days, currency, locale }: CalendarHeatmapProps): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);

  const { weeks, monthTicks } = useMemo(() => {
    const sortedNonZero = days
      .map((entry) => entry.outCents)
      .filter((value) => value > 0)
      .sort((a, b) => a - b);

    const cells: Cell[] = days.map((entry) => ({
      day: entry.day,
      outCents: entry.outCents,
      level: levelFor(entry.outCents, sortedNonZero),
    }));

    // Pad the first week so every column is a real Sun-Sat week, matching
    // GitHub's layout rather than starting mid-week.
    const leadingBlanks = days[0] ? isoWeekday(days[0].day) : 0;
    const padded: Array<Cell | null> = [...Array<null>(leadingBlanks).fill(null), ...cells];

    const weeks: Array<Array<Cell | null>> = [];
    for (let i = 0; i < padded.length; i += 7) {
      weeks.push(padded.slice(i, i + 7));
    }

    // One tick per week column where a new month starts, so the label row
    // stays sparse instead of repeating "Aug Aug Aug…".
    let lastMonth = '';
    const monthTicks = weeks.map((week) => {
      const firstRealDay = week.find((cell): cell is Cell => cell !== null);
      if (!firstRealDay) return '';
      const label = monthAbbrev(firstRealDay.day);
      if (label === lastMonth) return '';
      lastMonth = label;
      return label;
    });

    return { weeks, monthTicks };
  }, [days]);

  const active = days.find((entry) => entry.day === selected) ?? null;
  const total = days.reduce((sum, entry) => sum + entry.outCents, 0);
  const loggedDays = days.filter((entry) => entry.outCents > 0).length;

  return (
    <div className="heatmap">
      <div className="heatmap__scroll">
        <div className="heatmap__grid">
          <div className="heatmap__months" aria-hidden="true">
            {monthTicks.map((label, index) => (
              <span className="heatmap__month" key={index}>
                {label}
              </span>
            ))}
          </div>
          <div className="heatmap__weeks">
            {weeks.map((week, weekIndex) => (
              <div className="heatmap__week" key={weekIndex}>
                {week.map((cell, dayIndex) =>
                  cell === null ? (
                    <span className="heatmap__cell heatmap__cell--blank" key={dayIndex} />
                  ) : (
                    <button
                      type="button"
                      key={cell.day}
                      className={`heatmap__cell heatmap__cell--${cell.level}`}
                      aria-label={`${formatShortDate(cell.day)}: ${formatMoney(cell.outCents, { currency, locale })}`}
                      aria-pressed={selected === cell.day}
                      onClick={() => {
                        haptics.tap();
                        setSelected((current) => (current === cell.day ? null : cell.day));
                      }}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="heatmap__foot">
        {active ? (
          <p className="heatmap__detail">
            <span className="spark__detail-day">{formatShortDate(active.day)}</span>
            <span className="spark__detail-amount">
              {formatMoney(active.outCents, { currency, locale })}
            </span>
          </p>
        ) : (
          <p className="heatmap__summary">
            {formatMoney(total, { currency, locale, hideZeroCents: true })} spent over {loggedDays}{' '}
            {loggedDays === 1 ? 'day' : 'days'} logged
          </p>
        )}
        <div className="heatmap__scale" aria-hidden="true">
          <span>Less</span>
          <span className="heatmap__cell heatmap__cell--0" />
          <span className="heatmap__cell heatmap__cell--1" />
          <span className="heatmap__cell heatmap__cell--2" />
          <span className="heatmap__cell heatmap__cell--3" />
          <span className="heatmap__cell heatmap__cell--4" />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
