import { useState, type JSX } from 'react';
import type { Cadence, Category, Direction, MeResponse, RecurringRule } from '@spendlygo/shared';
import { RecurringForm } from '../components/RecurringForm';
import { formatMoney } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface SettingsScreenProps {
  me: MeResponse;
  busy: boolean;
  onSaveBudget: (cents: number | null) => void;
  onToggleDigest: (enabled: boolean) => void;
  onToggleAlerts: (enabled: boolean) => void;
  categories: Category[];
  today: string;
  recurringRules: RecurringRule[];
  recurringLoading: boolean;
  recurringBusy: boolean;
  onAddRecurring: (input: {
    direction: Direction;
    amountCents: number;
    categoryId: string | null;
    note: string | null;
    cadence: Cadence;
    anchorDate: string;
    dayOfMonth: number | null;
  }) => void;
  onDeleteRecurring: (id: string) => void;
}

const CADENCE_LABEL: Record<Cadence, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

export function SettingsScreen({
  me,
  busy,
  onSaveBudget,
  onToggleDigest,
  onToggleAlerts,
  categories,
  today,
  recurringRules,
  recurringLoading,
  recurringBusy,
  onAddRecurring,
  onDeleteRecurring,
}: SettingsScreenProps): JSX.Element {
  const { user } = me;
  const [draft, setDraft] = useState(
    user.monthlyBudgetCents === null ? '' : String(user.monthlyBudgetCents / 100),
  );
  const [addingRecurring, setAddingRecurring] = useState(false);

  const parsed = Number(draft.replace(/,/g, ''));
  const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  return (
    <div className="screen">
      <section className="card">
        <div className="card__label">Monthly budget</div>
        <p className="card__prose">
          The number everything else is derived from. Spendlygo divides what's left by the days
          remaining — so overspending today shrinks tomorrow.
        </p>
        <div className="field">
          <span className="field__prefix">{user.currency}</span>
          <input
            className="input input--flush"
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="1500"
            aria-label="Monthly budget"
          />
        </div>
        <button
          type="button"
          className="primary primary--inline"
          disabled={!valid || busy}
          onClick={() => {
            if (!valid) return;
            haptics.press();
            onSaveBudget(Math.round(parsed * 100));
          }}
        >
          {busy ? 'Saving…' : 'Save budget'}
        </button>
        {user.monthlyBudgetCents !== null && (
          <div className="card__foot card__foot--tight">
            <span>
              Currently{' '}
              {formatMoney(user.monthlyBudgetCents, {
                currency: user.currency,
                locale: user.locale,
                hideZeroCents: true,
              })}
            </span>
            <button
              type="button"
              className="link"
              onClick={() => {
                haptics.tap();
                onSaveBudget(null);
              }}
            >
              Clear
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card__label">Daily digest</div>
        <label className="toggle">
          <span>
            Nightly summary at {String(user.digestHour).padStart(2, '0')}:00
            <span className="toggle__hint">Plus a Sunday and end-of-month wrap-up</span>
          </span>
          <input
            type="checkbox"
            checked={user.digestEnabled}
            onChange={(event) => {
              haptics.select();
              onToggleDigest(event.target.checked);
            }}
          />
          <span className="toggle__track" aria-hidden="true" />
        </label>
      </section>

      <section className="card">
        <div className="card__label">Budget alerts</div>
        <label className="toggle">
          <span>
            Warn me at 80% and over budget
            <span className="toggle__hint">
              Sent the moment it happens, not just at digest time
            </span>
          </span>
          <input
            type="checkbox"
            checked={user.alertsEnabled}
            onChange={(event) => {
              haptics.select();
              onToggleAlerts(event.target.checked);
            }}
          />
          <span className="toggle__track" aria-hidden="true" />
        </label>
      </section>

      <section className="card">
        <div className="card__head">
          <span className="card__label">Recurring</span>
          {!addingRecurring && (
            <button
              type="button"
              className="link"
              onClick={() => {
                haptics.tap();
                setAddingRecurring(true);
              }}
            >
              + Add
            </button>
          )}
        </div>

        {addingRecurring ? (
          <RecurringForm
            categories={categories}
            currency={user.currency}
            locale={user.locale}
            today={today}
            busy={recurringBusy}
            onCancel={() => setAddingRecurring(false)}
            onSubmit={(input) => {
              onAddRecurring(input);
              setAddingRecurring(false);
            }}
          />
        ) : recurringLoading ? (
          <div className="skeleton" />
        ) : recurringRules.length === 0 ? (
          <p className="card__prose">
            Rent, salary, subscriptions — anything that happens on its own. Nothing set up yet.
          </p>
        ) : (
          <div className="recur-list">
            {recurringRules.map((rule) => (
              <div className="recur-row" key={rule.id}>
                <span className="recur-row__emoji" aria-hidden="true">
                  {rule.categoryEmoji ?? (rule.direction === 'in' ? '💰' : '🔁')}
                </span>
                <span className="recur-row__body">
                  <span className="recur-row__label">
                    {rule.note ?? rule.categoryName ?? 'Recurring'}
                  </span>
                  <span className="recur-row__meta">
                    every {CADENCE_LABEL[rule.cadence]}
                    {rule.dayOfMonth ? ` · day ${rule.dayOfMonth}` : ''}
                  </span>
                </span>
                <span
                  className={`recur-row__amount ${rule.direction === 'in' ? 'txn__amount--in' : ''}`}
                >
                  {rule.direction === 'in' ? '+' : '−'}
                  {formatMoney(rule.amountCents, { currency: user.currency, locale: user.locale })}
                </span>
                <button
                  type="button"
                  className="recur-row__remove"
                  aria-label={`Stop ${rule.note ?? 'this recurring transaction'}`}
                  onClick={() => {
                    haptics.rigid();
                    onDeleteRecurring(rule.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card__label">Account</div>
        <div className="row">
          <span className="row__key">Name</span>
          <span className="row__value">{user.firstName ?? '—'}</span>
        </div>
        <div className="row">
          <span className="row__key">Timezone</span>
          <span className="row__value">{user.timezone}</span>
        </div>
        <div className="row">
          <span className="row__key">Currency</span>
          <span className="row__value">{user.currency}</span>
        </div>
      </section>

      <p className="footnote">Your data is yours — CSV export is on the way.</p>
    </div>
  );
}
