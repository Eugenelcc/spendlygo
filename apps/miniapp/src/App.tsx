import { useEffect, useMemo, useState, type JSX } from 'react';
import type { CategoriesResponse, MeResponse } from '@spendlygo/shared';
import { api, ApiRequestError } from './lib/api';
import {
  applyThemeParams,
  isInsideTelegram,
  retrieveLaunchParams,
  type LaunchParams,
} from './lib/telegram';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; me: MeResponse; categories: CategoriesResponse }
  | { status: 'error'; message: string };

/**
 * Phase P0 — the connection screen.
 *
 * It exists to prove the full loop end to end: Telegram launch parameters are
 * read, initData reaches the server, the server verifies its signature, and a
 * real user row comes back. The Today screen in DESIGN.md section 7.1 replaces
 * this in phase P2.
 */
export function App(): JSX.Element {
  const launch = useMemo<LaunchParams>(() => retrieveLaunchParams(), []);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    applyThemeParams(launch.themeParams, launch.colorScheme);
  }, [launch]);

  useEffect(() => {
    const initData = launch.initData;
    if (!initData) return;

    let cancelled = false;

    void (async () => {
      try {
        const [me, categories] = await Promise.all([api.me(initData), api.categories(initData)]);
        if (!cancelled) setState({ status: 'ready', me, categories });
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof ApiRequestError
            ? error.message
            : 'Could not reach the server. Check your connection and try again.';
        setState({ status: 'error', message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [launch.initData]);

  if (!isInsideTelegram(launch)) {
    return (
      <main className="screen">
        <Brand />
        <div className="empty">
          <div className="empty__emoji">💬</div>
          <div className="empty__title">Open this from Telegram</div>
          <p className="empty__body">
            Spendlygo runs inside Telegram. Send <code>/app</code> to the bot to launch it.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="screen">
      <Brand />

      {state.status === 'loading' && (
        <div className="card">
          <div className="card__label">Connecting</div>
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton skeleton--short" />
        </div>
      )}

      {state.status === 'error' && (
        <div className="card">
          <div className="status">
            <span className="status__dot status__dot--error" />
            Not connected
          </div>
          <p style={{ marginBottom: 0, color: 'var(--text-subtle)', fontSize: 15 }}>
            {state.message}
          </p>
        </div>
      )}

      {state.status === 'ready' && <Connected me={state.me} categories={state.categories} />}

      <p className="footnote">Phase P0 · capture and statistics are on the way</p>
    </main>
  );
}

function Brand(): JSX.Element {
  return (
    <header className="brand">
      <span className="brand__name">Spendlygo</span>
      <span className="brand__version">preview</span>
    </header>
  );
}

function Connected({
  me,
  categories,
}: {
  me: MeResponse;
  categories: CategoriesResponse;
}): JSX.Element {
  const expenseCategories = categories.categories.filter((c) => c.kind === 'expense');
  const budget = me.user.monthlyBudgetCents;

  return (
    <>
      <div className="card">
        <div className="status">
          <span className="status__dot status__dot--ok" />
          Signed in as {me.user.firstName ?? 'you'}
        </div>
      </div>

      <div className="card card--stagger-1">
        <div className="card__label">Account</div>
        <div className="row">
          <span className="row__key">Today</span>
          <span className="row__value">{me.today}</span>
        </div>
        <div className="row">
          <span className="row__key">Timezone</span>
          <span className="row__value">{me.user.timezone}</span>
        </div>
        <div className="row">
          <span className="row__key">Currency</span>
          <span className="row__value">{me.user.currency}</span>
        </div>
        <div className="row">
          <span className="row__key">Monthly budget</span>
          <span className="row__value">
            {budget === null
              ? 'Not set yet'
              : formatCents(budget, me.user.locale, me.user.currency)}
          </span>
        </div>
      </div>

      <div className="card card--stagger-2">
        <div className="card__label">Categories · {expenseCategories.length}</div>
        <div className="chips">
          {expenseCategories.map((category) => (
            <span className="chip" key={category.id}>
              <span aria-hidden="true">{category.emoji}</span>
              {category.name}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Local formatter for the preview screen only. The shared `formatCents` in
 * @spendlygo/core becomes the single formatter once the Money component lands
 * in phase P2 (DESIGN.md section 8).
 */
function formatCents(cents: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(cents / 100);
}
