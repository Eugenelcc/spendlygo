import { useState, type JSX } from 'react';
import type { SavingsGoal } from '@spendlygo/shared';
import { currencySymbol, formatMoney, formatShortDate } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface GoalsSectionProps {
  goals: SavingsGoal[];
  loading: boolean;
  currency: string;
  locale: string;
  busy: boolean;
  onAdd: (input: { name: string; targetCents: number; targetDate: string | null }) => void;
  onContribute: (id: string, amountCents: number) => void;
  onArchive: (id: string) => void;
}

/**
 * Savings goals (PRD-adjacent), tracked separately from safe-to-spend.
 *
 * Contributing tags a transfer transaction to the goal — it shows up in
 * History like any other entry, but never moves the monthly budget
 * (PRD F6.7). See packages/core/src/savings.ts for the progress maths.
 */
export function GoalsSection({
  goals,
  loading,
  currency,
  locale,
  busy,
  onAdd,
  onContribute,
  onArchive,
}: GoalsSectionProps): JSX.Element {
  const [adding, setAdding] = useState(false);

  return (
    <section className="card">
      <div className="card__head">
        <span className="card__label">Savings goals</span>
        {!adding && (
          <button
            type="button"
            className="link"
            onClick={() => {
              haptics.tap();
              setAdding(true);
            }}
          >
            + Add
          </button>
        )}
      </div>

      {adding ? (
        <GoalForm
          currency={currency}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => {
            onAdd(input);
            setAdding(false);
          }}
        />
      ) : loading ? (
        <div className="skeleton" />
      ) : goals.length === 0 ? (
        <p className="card__prose">
          Something separate from the monthly budget — a trip, a deposit, an emergency fund.
        </p>
      ) : (
        <div className="goal-list">
          {goals.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              currency={currency}
              locale={locale}
              busy={busy}
              onContribute={(amountCents) => onContribute(goal.id, amountCents)}
              onArchive={() => onArchive(goal.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GoalForm({
  currency,
  busy,
  onCancel,
  onSubmit,
}: {
  currency: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: { name: string; targetCents: number; targetDate: string | null }) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');

  const parsedTarget = Number(target.replace(/,/g, ''));
  const valid = name.trim() !== '' && target.trim() !== '' && parsedTarget > 0;

  return (
    <div className="goal-form">
      <input
        className="input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="What are you saving for?"
        maxLength={80}
        aria-label="Goal name"
      />
      <div className="field">
        <span className="field__prefix">{currencySymbol(currency)}</span>
        <input
          className="input input--flush"
          inputMode="decimal"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="1000"
          aria-label="Target amount"
        />
      </div>
      <div className="field">
        <span className="field__prefix">By</span>
        <input
          className="input input--flush"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          aria-label="Target date (optional)"
        />
      </div>

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
              name: name.trim(),
              targetCents: Math.round(parsedTarget * 100),
              targetDate: date === '' ? null : date,
            });
          }}
        >
          {busy ? 'Saving…' : 'Create goal'}
        </button>
      </div>
    </div>
  );
}

function GoalRow({
  goal,
  currency,
  locale,
  busy,
  onContribute,
  onArchive,
}: {
  goal: SavingsGoal;
  currency: string;
  locale: string;
  busy: boolean;
  onContribute: (amountCents: number) => void;
  onArchive: () => void;
}): JSX.Element {
  const [contributing, setContributing] = useState(false);
  const [amount, setAmount] = useState('');

  const parsedAmount = Number(amount.replace(/,/g, ''));
  const validAmount = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const percent = Math.round(goal.progressRatio * 100);
  const meterClass = goal.achieved ? 'meter__fill--ahead' : goal.overdue ? 'meter__fill--over' : '';

  return (
    <div className="goal-row">
      <div className="goal-row__head">
        <span className="goal-row__name">{goal.name}</span>
        <button
          type="button"
          className="recur-row__remove"
          aria-label={`Archive ${goal.name}`}
          onClick={() => {
            haptics.rigid();
            onArchive();
          }}
        >
          ×
        </button>
      </div>

      <div className="meter">
        <div className={`meter__fill ${meterClass}`} style={{ width: `${percent}%` }} />
      </div>

      <div className="goal-row__meta">
        <span>
          {formatMoney(goal.contributedCents, { currency, locale, hideZeroCents: true })} of{' '}
          {formatMoney(goal.targetCents, { currency, locale, hideZeroCents: true })}
        </span>
        <span>
          {goal.achieved
            ? 'Reached 🎉'
            : goal.overdue
              ? 'Overdue'
              : goal.targetDate
                ? `by ${formatShortDate(goal.targetDate)}`
                : `${percent}%`}
        </span>
      </div>

      {!goal.achieved && goal.suggestedMonthlyCents !== null && (
        <p className="goal-row__hint">
          {formatMoney(goal.suggestedMonthlyCents, { currency, locale, hideZeroCents: true })}/month
          to hit it
        </p>
      )}

      {contributing ? (
        <div className="goal-row__contribute">
          <div className="field">
            <span className="field__prefix">{currencySymbol(currency, locale)}</span>
            <input
              className="input input--flush"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="50"
              aria-label={`Amount to add to ${goal.name}`}
            />
          </div>
          <div className="recur-form__actions">
            <button
              type="button"
              className="link"
              onClick={() => {
                setContributing(false);
                setAmount('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary primary--inline"
              disabled={!validAmount || busy}
              onClick={() => {
                if (!validAmount) return;
                haptics.press();
                onContribute(Math.round(parsedAmount * 100));
                setContributing(false);
                setAmount('');
              }}
            >
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.tap();
            setContributing(true);
          }}
        >
          + Put money in
        </button>
      )}
    </div>
  );
}
