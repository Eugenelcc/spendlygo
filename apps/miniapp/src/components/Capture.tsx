import { useMemo, useState, type JSX } from 'react';
import type { Category, Direction } from '@spendlygo/shared';
import { currencySymbol } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface CaptureProps {
  categories: Category[];
  currency: string;
  locale: string;
  today: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: {
    direction: Direction;
    amountCents: number;
    categoryId: string | null;
    note: string | null;
    occurredOn: string;
  }) => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

/** Digits typed on the pad, held as a string so "12." is a valid in-between state. */
function toCents(raw: string): number {
  if (raw === '' || raw === '.') return 0;
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(`${whole || '0'}${fraction.padEnd(2, '0').slice(0, 2)}`);
  return Number.isFinite(cents) ? cents : 0;
}

function press(raw: string, key: string): string {
  if (key === '⌫') return raw.slice(0, -1);

  if (key === '.') {
    if (raw.includes('.')) return raw;
    return raw === '' ? '0.' : `${raw}.`;
  }

  // Two decimal places is all money has.
  const [, fraction] = raw.split('.');
  if (fraction !== undefined && fraction.length >= 2) return raw;

  // Stop before the amount stops being plausible.
  if (raw.replace('.', '').length >= 9) return raw;

  if (raw === '0') return key;
  return raw + key;
}

function previousDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function Capture({
  categories,
  currency,
  locale,
  today,
  busy,
  error,
  onSubmit,
}: CaptureProps): JSX.Element {
  const [direction, setDirection] = useState<Direction>('out');
  const [raw, setRaw] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);

  const cents = toCents(raw);
  const canSave = cents > 0 && !busy;

  const visible = useMemo(
    () => categories.filter((c) => c.kind === (direction === 'in' ? 'income' : 'expense')),
    [categories, direction],
  );

  const display = raw === '' ? '0.00' : raw;

  return (
    <div className="capture">
      <div className="seg" role="tablist" aria-label="Direction">
        {(['out', 'in'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={direction === value}
            className={`seg__option ${direction === value ? 'seg__option--on' : ''}`}
            onClick={() => {
              haptics.select();
              setDirection(value);
              // Categories are per-kind, so a stale selection would be invalid.
              setCategoryId(null);
            }}
          >
            {value === 'out' ? 'Spent' : 'Received'}
          </button>
        ))}
      </div>

      <div className="capture__amount">
        <span className="capture__symbol">{currencySymbol(currency, locale)}</span>
        <span className={`capture__digits ${raw === '' ? 'capture__digits--empty' : ''}`}>
          {display}
        </span>
      </div>

      <div className="chips" role="group" aria-label="Category">
        {visible.map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={categoryId === category.id}
            className={`chip ${categoryId === category.id ? 'chip--on' : ''}`}
            onClick={() => {
              haptics.select();
              setCategoryId(categoryId === category.id ? null : category.id);
            }}
          >
            <span aria-hidden="true">{category.emoji}</span>
            {category.name}
          </button>
        ))}
      </div>

      <input
        className="input"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What was it for? (optional)"
        maxLength={280}
        aria-label="Note"
      />

      <div className="daypick">
        {[
          { value: today, label: 'Today' },
          { value: previousDay(today), label: 'Yesterday' },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className={`chip chip--sm ${occurredOn === option.value ? 'chip--on' : ''}`}
            onClick={() => {
              haptics.select();
              setOccurredOn(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
        <input
          className="daypick__date"
          type="date"
          value={occurredOn}
          max={today}
          onChange={(event) => setOccurredOn(event.target.value || today)}
          aria-label="Date"
        />
      </div>

      <div className="pad">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className={`pad__key ${key === '⌫' ? 'pad__key--soft' : ''}`}
            onClick={() => {
              haptics.tap();
              setRaw((current) => press(current, key));
            }}
            aria-label={key === '⌫' ? 'Delete' : key}
          >
            {key}
          </button>
        ))}
      </div>

      {error && <p className="capture__error">{error}</p>}

      <button
        type="button"
        className="primary"
        disabled={!canSave}
        onClick={() => {
          if (!canSave) return;
          haptics.press();
          onSubmit({
            direction,
            amountCents: cents,
            categoryId,
            note: note.trim() === '' ? null : note.trim(),
            occurredOn,
          });
        }}
      >
        {busy ? 'Saving…' : `Save ${currencySymbol(currency, locale)}${display}`}
      </button>
    </div>
  );
}
