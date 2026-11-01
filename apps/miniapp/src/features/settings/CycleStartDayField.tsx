import { useEffect, useState, type JSX } from 'react';
import { haptics } from '../../lib/telegram';
import './cycle-start-day.css';

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/** "1st", "2nd", "3rd", "4th" … "11th" … "21st" … (display only; the server owns the real rule). */
function ordinal(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${day}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

export interface CycleStartDayFieldProps {
  /** The saved day (`me.cycle.startDay`, or 1 from an older server). */
  startDay: number;
  /** `me.cycle.label`: "20 Oct – 19 Nov" for day ≠ 1. */
  label: string | undefined;
  isShared: boolean;
  /** Resolves when saved, rejects when the server refuses (the field then shows the old day again). */
  onChange: (day: number) => Promise<unknown>;
}

export function CycleStartDayField({
  startDay,
  label,
  isShared,
  onChange,
}: CycleStartDayFieldProps): JSX.Element {
  // What the user picked while the save is in flight; null means "show the saved day".
  const [chosen, setChosen] = useState<number | null>(null);
  // True from the pick until the save settles, so a quick second pick can't send a second PATCH.
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => setChosen(null), [startDay]);

  const shown = chosen ?? startDay;

  function pick(day: number): void {
    haptics.select();
    setChosen(day);
    setIsSaving(true);
    onChange(day)
      .catch(() => setChosen(null))
      .finally(() => setIsSaving(false));
  }

  return (
    <div className="cycle-field">
      <div className="field-row">
        <label className="field-row__label" htmlFor="cycle-start-day">
          Budget month starts on
        </label>
        <select
          id="cycle-start-day"
          className="input"
          value={shown}
          disabled={isSaving}
          onChange={(event) => pick(Number(event.target.value))}
        >
          {DAYS.map((day) => (
            <option key={day} value={day}>
              {day === 1 ? '1st (calendar month)' : ordinal(day)}
            </option>
          ))}
        </select>
      </div>
      <p className="cycle-field__caption">
        {startDay === 1 || !label ? 'Calendar month' : `This cycle: ${label}`}
      </p>
      {shown >= 29 && (
        <p className="cycle-field__hint">
          In shorter months the cycle starts on the month's last day.
        </p>
      )}
      {isShared && (
        <p className="cycle-field__hint">
          Changes it for everyone in this space. They'll get a message.
        </p>
      )}
    </div>
  );
}
