import type { JSX } from 'react';
import { formatMoney, formatShortDate } from '../lib/format';

export interface GoalProgressPoint {
  day: string;
  /** out minus in for that day — a withdrawal shows negative. */
  netCents: number;
}

export interface GoalProgressChartProps {
  points: GoalProgressPoint[];
  targetCents: number;
  currency: string;
  locale: string;
}

const WIDTH = 320;
const HEIGHT = 110;
const PAD_X = 4;
const PAD_Y = 10;

/**
 * Cumulative contribution toward a goal's target, over its whole history —
 * a running total climbing (or dipping, on a withdrawal) toward a dashed
 * target line. Same hand-written SVG technique as LineChart, just with a
 * fixed reference line instead of a zero line (GUARDRAILS.md section 8).
 */
export function GoalProgressChart({
  points,
  targetCents,
  currency,
  locale,
}: GoalProgressChartProps): JSX.Element | null {
  if (points.length < 2) return null;

  let running = 0;
  const cumulative = points.map((point) => (running += point.netCents));
  const max = Math.max(targetCents, ...cumulative, 0);
  const min = Math.min(0, ...cumulative);
  const range = max - min || 1;

  const plotWidth = WIDTH - PAD_X * 2;
  const plotHeight = HEIGHT - PAD_Y * 2;
  const stepX = plotWidth / (points.length - 1);
  const yFor = (value: number) => PAD_Y + (1 - (value - min) / range) * plotHeight;

  const coords = cumulative.map((value, index) => ({ x: PAD_X + index * stepX, y: yFor(value) }));
  const linePath = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');
  const last = coords[coords.length - 1];
  const areaPath = last
    ? `${linePath} L ${last.x.toFixed(1)} ${(HEIGHT - PAD_Y).toFixed(1)} L ${PAD_X} ${(HEIGHT - PAD_Y).toFixed(1)} Z`
    : '';

  const finalTotal = cumulative[cumulative.length - 1] ?? 0;
  const reached = finalTotal >= targetCents;
  const targetY = yFor(targetCents);

  return (
    <div className="goalchart">
      <svg
        className="goalchart__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Progress toward ${formatMoney(targetCents, { currency, locale })}, currently ${formatMoney(finalTotal, { currency, locale })}`}
      >
        <line
          className="goalchart__target"
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={targetY}
          y2={targetY}
        />
        <path
          className={`goalchart__area ${reached ? 'goalchart__area--reached' : ''}`}
          d={areaPath}
        />
        <path
          className={`goalchart__line ${reached ? 'goalchart__line--reached' : ''}`}
          d={linePath}
          fill="none"
        />
      </svg>
      <div className="goalchart__foot">
        <span>{formatShortDate(points[0]?.day ?? '')}</span>
        <span className="goalchart__target-label">
          Target {formatMoney(targetCents, { currency, locale, hideZeroCents: true })}
        </span>
        <span>{formatShortDate(points[points.length - 1]?.day ?? '')}</span>
      </div>
    </div>
  );
}
