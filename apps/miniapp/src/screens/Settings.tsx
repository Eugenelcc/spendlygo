import { useState, type JSX } from 'react';
import type { MeResponse } from '@spendlygo/shared';
import { formatMoney } from '../lib/format';
import { haptics } from '../lib/telegram';

export interface SettingsScreenProps {
  me: MeResponse;
  busy: boolean;
  onSaveBudget: (cents: number | null) => void;
  onToggleDigest: (enabled: boolean) => void;
}

export function SettingsScreen({
  me,
  busy,
  onSaveBudget,
  onToggleDigest,
}: SettingsScreenProps): JSX.Element {
  const { user } = me;
  const [draft, setDraft] = useState(
    user.monthlyBudgetCents === null ? '' : String(user.monthlyBudgetCents / 100),
  );

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
            <span className="toggle__hint">What you spent, and tomorrow's number</span>
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

      <p className="footnote">
        Your data is yours. Send <code>/export</code> to the bot for a CSV of everything.
      </p>
    </div>
  );
}
