import { useMemo, useState, type JSX } from 'react';
import type { Category, Direction } from '@spendlygo/shared';
import { currencySymbol, formatMoney } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface CaptureProps {
  categories: Category[];
  currency: string;
  locale: string;
  today: string;
  busy: boolean;
  error: string | null;
  /** The foreign-currency picker's selection, or null in normal (home-currency) mode — ADR 0007. */
  foreignCurrency: string | null;
  onForeignCurrencyChange: (currency: string | null) => void;
  /** A live preview of the rate for `foreignCurrency`; the server fetches its own at save time regardless. */
  fxRate: number | undefined;
  fxRateLoading: boolean;
  onSubmit: (input: {
    direction: Direction;
    amountCents?: number;
    originalCurrency?: string;
    originalAmountCents?: number;
    categoryId: string | null;
    note: string | null;
    occurredOn: string;
  }) => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

/**
 * 2-decimal ISO 4217 currencies only (ADR 0007) — a zero-decimal currency
 * (JPY, KRW, VND, …) treated as "amount × 100 cents" would misconvert by
 * 100x, so it's left out of the picker rather than silently mishandled.
 */
const FOREIGN_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'AUD',
  'CAD',
  'CHF',
  'CNY',
  'HKD',
  'INR',
  'MYR',
  'NZD',
  'PHP',
  'THB',
  'ZAR',
];

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
  foreignCurrency,
  onForeignCurrencyChange,
  fxRate,
  fxRateLoading,
  onSubmit,
}: CaptureProps): JSX.Element {
  const [direction, setDirection] = useState<Direction>('out');
  const [raw, setRaw] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);

  const cents = toCents(raw);
  const canSave = cents > 0 && !busy && (!foreignCurrency || (!fxRateLoading && !!fxRate));

  const visible = useMemo(
    () => categories.filter((c) => c.kind === (direction === 'in' ? 'income' : 'expense')),
    [categories, direction],
  );

  const otherCurrencies = useMemo(
    () => FOREIGN_CURRENCIES.filter((code) => code !== currency),
    [currency],
  );

  const display = raw === '' ? '0.00' : raw;
  const activeSymbol = foreignCurrency
    ? currencySymbol(foreignCurrency, locale)
    : currencySymbol(currency, locale);

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
        <span className="capture__symbol">{activeSymbol}</span>
        <span className={`capture__digits ${raw === '' ? 'capture__digits--empty' : ''}`}>
          {display}
        </span>
      </div>

      <div className="capture__fx">
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.tap();
            onForeignCurrencyChange(foreignCurrency ? null : (otherCurrencies[0] ?? 'USD'));
          }}
        >
          {foreignCurrency ? '✕ Use home currency' : `🌍 Paid in another currency`}
        </button>
        {foreignCurrency && (
          <select
            className="input capture__fx-select"
            value={foreignCurrency}
            aria-label="Foreign currency"
            onChange={(event) => onForeignCurrencyChange(event.target.value)}
          >
            {otherCurrencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )}
      </div>

      {foreignCurrency && cents > 0 && (
        <p className="capture__fx-preview">
          {fxRateLoading
            ? 'Converting…'
            : fxRate
              ? `≈ ${formatMoney(Math.round(cents * fxRate), { currency, locale })}`
              : "Couldn't fetch a rate — try again"}
        </p>
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
            ...(foreignCurrency
              ? { originalCurrency: foreignCurrency, originalAmountCents: cents }
              : { amountCents: cents }),
            categoryId,
            note: note.trim() === '' ? null : note.trim(),
            occurredOn,
          });
        }}
      >
        {busy ? 'Saving…' : `Save ${activeSymbol}${display}`}
      </button>
    </div>
  );
}
