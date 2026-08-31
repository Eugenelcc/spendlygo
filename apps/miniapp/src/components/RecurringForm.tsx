import { useState, type JSX } from 'react';
import type { Cadence, Category, Direction } from '@spendlygo/shared';
import { currencySymbol } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface RecurringFormProps {
  categories: Category[];
  currency: string;
  locale: string;
  today: string;
  busy: boolean;
  onSubmit: (input: {
    direction: Direction;
    amountCents: number;
    categoryId: string | null;
    note: string | null;
    cadence: Cadence;
    anchorDate: string;
    dayOfMonth: number | null;
  }) => void;
  onCancel: () => void;
}

const CADENCES: Array<{ value: Cadence; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'daily', label: 'Daily' },
];

function dayOfMonthFrom(isoDate: string): number {
  return Number(isoDate.slice(-2));
}

export function RecurringForm({
  categories,
  currency,
  locale,
  today,
  busy,
  onSubmit,
  onCancel,
}: RecurringFormProps): JSX.Element {
  const [direction, setDirection] = useState<Direction>('out');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState(dayOfMonthFrom(today));

  const parsedAmount = Number(amount.replace(/,/g, ''));
  const valid = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const needsDay = cadence === 'monthly' || cadence === 'yearly';
  const visible = categories.filter((c) => c.kind === (direction === 'in' ? 'income' : 'expense'));

  return (
    <div className="recur-form">
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
              setCategoryId(null);
            }}
          >
            {value === 'out' ? 'Expense' : 'Income'}
          </button>
        ))}
      </div>

      <div className="field">
        <span className="field__prefix">{currencySymbol(currency, locale)}</span>
        <input
          className="input input--flush"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="1500"
          aria-label="Amount"
        />
      </div>

      <div className="chips" role="group" aria-label="How often">
        {CADENCES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={cadence === option.value}
            className={`chip ${cadence === option.value ? 'chip--on' : ''}`}
            onClick={() => {
              haptics.select();
              setCadence(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {needsDay && (
        <div className="field">
          <span className="field__prefix">Day</span>
          <input
            className="input input--flush"
            type="number"
            min={1}
            max={31}
            value={dayOfMonth}
            onChange={(event) =>
              setDayOfMonth(Math.min(31, Math.max(1, Number(event.target.value) || 1)))
            }
            aria-label="Day of month"
          />
        </div>
      )}

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
        placeholder="What is it? (rent, salary, Netflix…)"
        maxLength={280}
        aria-label="Note"
      />

      <div className="recur-form__actions">
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary primary--inline"
          disabled={!valid || busy}
          onClick={() => {
            if (!valid) return;
            haptics.press();
            onSubmit({
              direction,
              amountCents: Math.round(parsedAmount * 100),
              categoryId,
              note: note.trim() === '' ? null : note.trim(),
              cadence,
              anchorDate: today,
              dayOfMonth: needsDay ? dayOfMonth : null,
            });
          }}
        >
          {busy ? 'Saving…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
