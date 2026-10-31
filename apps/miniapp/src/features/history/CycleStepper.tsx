import type { JSX } from 'react';
import { haptics } from '../../lib/telegram';
import './cycle-stepper.css';

export interface CycleStepperProps {
  label: string | undefined;
  loading: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** `‹ 20 Oct – 19 Nov ›`: same markup and classes as History's month picker. */
export function CycleStepper({
  label,
  loading,
  canGoNext,
  onPrevious,
  onNext,
}: CycleStepperProps): JSX.Element {
  return (
    <div className="date-range">
      <button
        type="button"
        className="date-range__step"
        aria-label="Previous cycle"
        disabled={loading || label === undefined}
        onClick={() => {
          haptics.tap();
          onPrevious();
        }}
      >
        ‹
      </button>
      <div className="cycle-stepper__label" aria-live="polite">
        {label ?? (loading ? '…' : '')}
      </div>
      <button
        type="button"
        className="date-range__step"
        aria-label="Next cycle"
        disabled={loading || !canGoNext}
        onClick={() => {
          haptics.tap();
          onNext();
        }}
      >
        ›
      </button>
    </div>
  );
}
