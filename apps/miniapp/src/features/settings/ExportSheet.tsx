import { useState, type JSX } from 'react';
import type { MeResponse } from '@spendlygo/shared';
import { Sheet } from '../../components/Sheet';
import { haptics } from '../../lib/telegram';
import './export-sheet.css';

type Choice = 'all' | 'cycle' | 'last-cycle' | 'month' | 'custom';

export interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  me: MeResponse;
  /** Today's date from the server (YYYY-MM-DD). */
  today: string;
  busy: boolean;
  /** `undefined` = everything (sends no `range`, so it also works on an old server). */
  onExport: (range?: string) => void;
}

/**
 * Settings > Export CSV (PRD F8.1, F17). Everything is preselected; the cycle
 * options appear only when the server told us the cycle (an old server omits it).
 */
export function ExportSheet({
  open,
  onClose,
  me,
  today,
  busy,
  onExport,
}: ExportSheetProps): JSX.Element | null {
  const thisMonth = today.slice(0, 7);
  const [choice, setChoice] = useState<Choice>('all');
  const [month, setMonth] = useState(thisMonth);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const isMonthCycle = (me.cycle?.startDay ?? 1) === 1;
  const options: Array<{ id: Choice; label: string; caption?: string }> = [
    { id: 'all', label: 'Everything' },
    ...(me.cycle
      ? [
          {
            id: 'cycle' as const,
            label: isMonthCycle ? 'This month' : 'This cycle',
            caption: me.cycle.label,
          },
        ]
      : []),
    ...(me.previousCycle
      ? [
          {
            id: 'last-cycle' as const,
            label: isMonthCycle ? 'Last month' : 'Last cycle',
            caption: me.previousCycle.label,
          },
        ]
      : []),
    { id: 'month', label: 'Pick a month' },
    { id: 'custom', label: 'Custom dates' },
  ];

  const range = ((): string | undefined | null => {
    switch (choice) {
      case 'all':
        return undefined;
      case 'cycle':
      case 'last-cycle':
        return choice;
      case 'month':
        return month === '' ? null : month;
      case 'custom':
        return from !== '' && to !== '' && from <= to ? `${from}..${to}` : null;
    }
  })();

  return (
    <Sheet open={open} onClose={onClose} title="Export CSV">
      <h2 className="export-sheet__title">Export CSV</h2>
      <fieldset className="export-sheet__options" aria-label="What to export">
        {options.map((option) => (
          <label
            key={option.id}
            className={`export-sheet__option${choice === option.id ? ' export-sheet__option--on' : ''}`}
          >
            <input
              type="radio"
              name="export-range"
              checked={choice === option.id}
              onChange={() => {
                haptics.select();
                setChoice(option.id);
              }}
            />
            <span className="export-sheet__label">{option.label}</span>
            {option.caption && <span className="export-sheet__caption">{option.caption}</span>}
          </label>
        ))}
      </fieldset>

      {choice === 'month' && (
        <div className="export-sheet__extra">
          <input
            className="input"
            type="month"
            aria-label="Month"
            value={month}
            max={thisMonth}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>
      )}
      {choice === 'custom' && (
        <div className="export-sheet__extra date-range">
          <input
            className="input"
            type="date"
            aria-label="From"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
          />
          <span className="date-range__sep">to</span>
          <input
            className="input"
            type="date"
            aria-label="To"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      )}

      <button
        type="button"
        className="primary"
        disabled={busy || range === null}
        onClick={() => {
          haptics.select();
          onExport(range ?? undefined);
          onClose();
        }}
      >
        {busy ? 'Preparing…' : 'Download'}
      </button>
    </Sheet>
  );
}
