import type { JSX } from 'react';
import { formatMoney } from '../lib/format';

export interface LineChartPoint {
  key: string;
  label: string;
  outCents: number;
  inCents: number;
}

export interface LineChartProps {
  data: LineChartPoint[];
  currency: string;
  locale: string;
}

const WIDTH = 320;
const HEIGHT = 100;
const PAD_X = 4;
const PAD_Y = 10;

/**
 * Cumulative net (income minus expense) across the period, running total —
 * up while you're ahead, down while you're not. Hand-written SVG, matching
 * BarChart and Ring: no charting library (GUARDRAILS.md section 8).
 */
export function LineChart({ data, currency, locale }: LineChartProps): JSX.Element | null {
  if (data.length < 2) return null;

  let running = 0;
  const cumulative = data.map((point) => (running += point.inCents - point.outCents));
  const min = Math.min(0, ...cumulative);
  const max = Math.max(0, ...cumulative);
  const range = max - min || 1;

  const plotWidth = WIDTH - PAD_X * 2;
  const plotHeight = HEIGHT - PAD_Y * 2;
  const stepX = plotWidth / (data.length - 1);
  const yFor = (value: number) => PAD_Y + (1 - (value - min) / range) * plotHeight;

  const coords = cumulative.map((value, index) => ({ x: PAD_X + index * stepX, y: yFor(value) }));
  const linePath = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');
  const last = coords[coords.length - 1];
  const areaPath = last
    ? `${linePath} L ${last.x.toFixed(1)} ${(HEIGHT - PAD_Y).toFixed(1)} L ${PAD_X} ${(HEIGHT - PAD_Y).toFixed(1)} Z`
    : '';

  const finalNet = cumulative[cumulative.length - 1] ?? 0;
  const up = finalNet >= 0;
  const zeroY = yFor(0);

  return (
    <div className="linechart">
      <div className="linechart__head">
        <span className="card__label">Net trend</span>
        <span
          className={`linechart__value ${up ? 'linechart__value--up' : 'linechart__value--down'}`}
        >
          <span aria-hidden="true">{up ? '📈' : '📉'}</span>
          {formatMoney(finalNet, { currency, locale, signed: true })}
        </span>
      </div>
      <svg
        className="linechart__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Running net over this period, ending ${formatMoney(finalNet, { currency, locale, signed: true })}`}
      >
        <line className="linechart__zero" x1={PAD_X} x2={WIDTH - PAD_X} y1={zeroY} y2={zeroY} />
        <path
          className={`linechart__area ${up ? 'linechart__area--up' : 'linechart__area--down'}`}
          d={areaPath}
        />
        <path
          className={`linechart__line ${up ? 'linechart__line--up' : 'linechart__line--down'}`}
          d={linePath}
          fill="none"
        />
      </svg>
      <div className="linechart__foot">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
