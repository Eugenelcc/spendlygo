import type { JSX } from 'react';

export interface SparklineProps {
  values: number[];
  label: string;
}

/** Seven bars, no axes — a shape, not a chart. */
export function Sparkline({ values, label }: SparklineProps): JSX.Element {
  const max = Math.max(1, ...values);

  return (
    <div className="spark" role="img" aria-label={label}>
      {values.map((value, index) => (
        <div
          className={`spark__bar ${index === values.length - 1 ? 'spark__bar--now' : ''}`}
          key={index}
          style={{ height: `${Math.max(6, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
