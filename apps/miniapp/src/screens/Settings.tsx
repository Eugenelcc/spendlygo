import { useState, type JSX } from 'react';
import type {
  Cadence,
  Category,
  Direction,
  MeResponse,
  RecurringRule,
  SavingsGoal,
} from '@spendlygo/shared';
import { GoalsSection } from '../components/GoalsSection';
import { HouseholdSection } from '../components/HouseholdSection';
import { RecurringForm } from '../components/RecurringForm';
import { daysInMonth, formatMoney } from '../lib/format';
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
  householdInviteCode: string | null;
  householdInviteBusy: boolean;
  householdLeaveBusy: boolean;
  onCreateHouseholdInvite: () => void;
  onLeaveHousehold: () => void;
  goals: SavingsGoal[];
  goalsLoading: boolean;
  goalsBusy: boolean;
  onAddGoal: (input: { name: string; targetCents: number; targetDate: string | null }) => void;
  onContributeGoal: (id: string, amountCents: number) => void;
  onArchiveGoal: (id: string) => void;
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
  householdInviteCode,
  householdInviteBusy,
  householdLeaveBusy,
  onCreateHouseholdInvite,
  onLeaveHousehold,
  goals,
  goalsLoading,
  goalsBusy,
  onAddGoal,
  onContributeGoal,
  onArchiveGoal,
}: SettingsScreenProps): JSX.Element {
  const { user } = me;
  const [budgetMode, setBudgetMode] = useState<'monthly' | 'daily'>('monthly');
  const [draft, setDraft] = useState(
    user.monthlyBudgetCents === null ? '' : String(user.monthlyBudgetCents / 100),
  );
  const [addingRecurring, setAddingRecurring] = useState(false);

  const daysThisMonth = daysInMonth(today);
  const parsed = Number(draft.replace(/,/g, ''));
  const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
  // Whatever mode the field is in, this is always the monthly figure that
  // actually gets saved — safe-to-spend still runs off one monthly budget
  // (PRD F6), a daily entry is just a more convenient way to set it.
  const monthlyCentsFromDraft = valid
    ? Math.round((budgetMode === 'daily' ? parsed * daysThisMonth : parsed) * 100)
    : null;

  function switchBudgetMode(next: 'monthly' | 'daily'): void {
    if (next === budgetMode) return;
    haptics.select();
    if (valid) {
      const converted = next === 'daily' ? parsed / daysThisMonth : parsed * daysThisMonth;
      setDraft(converted.toFixed(2).replace(/\.00$/, ''));
    }
    setBudgetMode(next);
  }

  return (
    <div className="screen">
      <section className="card">
        <div className="card__label">Budget</div>
        <p className="card__prose">
          The number everything else is derived from. Spendlygo divides what's left by the days
          remaining — so overspending today shrinks tomorrow.
        </p>

        <div className="seg" role="tablist" aria-label="Set budget as">
          {(['monthly', 'daily'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={budgetMode === mode}
              className={`seg__option ${budgetMode === mode ? 'seg__option--on' : ''}`}
              onClick={() => switchBudgetMode(mode)}
            >
              {mode === 'monthly' ? 'Monthly' : 'Daily'}
            </button>
          ))}
        </div>

        <div className="field">
          <span className="field__prefix">{user.currency}</span>
          <input
            className="input input--flush"
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={budgetMode === 'monthly' ? '1500' : '50'}
            aria-label={budgetMode === 'monthly' ? 'Monthly budget' : 'Daily budget'}
          />
        </div>

        {valid && monthlyCentsFromDraft !== null && (
          <p className="card__foot card__foot--tight">
            {budgetMode === 'daily' ? (
              <span>
                ={' '}
                {formatMoney(monthlyCentsFromDraft, {
                  currency: user.currency,
                  locale: user.locale,
                  hideZeroCents: true,
                })}
                /month ({daysThisMonth} days this month)
              </span>
            ) : (
              <span>
                ≈{' '}
                {formatMoney(Math.floor(monthlyCentsFromDraft / daysThisMonth), {
                  currency: user.currency,
                  locale: user.locale,
                })}
                /day
              </span>
            )}
          </p>
        )}

        <button
          type="button"
          className="primary primary--inline"
          disabled={!valid || busy}
          onClick={() => {
            if (monthlyCentsFromDraft === null) return;
            haptics.press();
            onSaveBudget(monthlyCentsFromDraft);
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
              })}{' '}
              ·{' '}
              {formatMoney(Math.floor(user.monthlyBudgetCents / daysThisMonth), {
                currency: user.currency,
                locale: user.locale,
              })}
              /day
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

      <HouseholdSection
        household={me.household}
        loading={false}
        inviteCode={householdInviteCode}
        inviteBusy={householdInviteBusy}
        leaveBusy={householdLeaveBusy}
        onCreateInvite={onCreateHouseholdInvite}
        onLeave={onLeaveHousehold}
      />

      <GoalsSection
        goals={goals}
        loading={goalsLoading}
        currency={user.currency}
        locale={user.locale}
        busy={goalsBusy}
        onAdd={onAddGoal}
        onContribute={onContributeGoal}
        onArchive={onArchiveGoal}
      />

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
