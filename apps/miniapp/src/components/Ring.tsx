import type { JSX } from 'react';

export interface RingProps {
  /** 0-1. Values above 1 are clamped; the colour carries "over budget". */
  progress: number;
  /** A DESIGN.md section 2.2 pace token. */
  tone: 'ahead' | 'ontrack' | 'behind' | 'over' | 'idle';
  size?: number;
  children?: React.ReactNode;
  label?: string;
}

/**
 * The safe-to-spend ring (DESIGN.md section 7.1).
 *
 * Hand-drawn SVG rather than a chart library: two circles and a dash offset
 * cost nothing and animate exactly how we want (GUARDRAILS.md section 8).
 */
export function Ring({ progress, tone, size = 210, children, label }: RingProps): JSX.Element {
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={label ?? `${Math.round(clamped * 100)}% of budget used`}
      >
        <circle
          className="ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          className={`ring__value ring__value--${tone}`}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          // Sweeps from empty to its value on mount, and animates between
          // values afterwards, so a saved spend is visibly felt.
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring__content">{children}</div>
    </div>
  );
}
