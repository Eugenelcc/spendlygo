import { useEffect, useMemo, useState, type JSX } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { StatsPeriod, Transaction } from '@spendlygo/shared';
import { api, ApiRequestError, setInitData } from './lib/api';
import {
  applyThemeParams,
  haptics,
  isInsideTelegram,
  retrieveLaunchParams,
  signalReady,
  type LaunchParams,
} from './lib/telegram';
import { Capture } from './components/Capture';
import { Sheet } from './components/Sheet';
import { TodayScreen } from './screens/Today';
import { StatsScreen } from './screens/Stats';
import { HistoryScreen } from './screens/History';
import { SettingsScreen } from './screens/Settings';
import { formatMoney } from './lib/format';

type Tab = 'today' | 'stats' | 'history' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'today', label: 'Today', icon: '◎' },
  { id: 'stats', label: 'Stats', icon: '◧' },
  { id: 'history', label: 'History', icon: '≡' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // The free instance sleeps; a failed first request is usually a cold
      // start rather than a real error, so retry patiently.
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
  },
});

export function App(): JSX.Element {
  const launch = useMemo<LaunchParams>(() => retrieveLaunchParams(), []);

  useEffect(() => {
    applyThemeParams(launch.themeParams, launch.colorScheme);
    if (launch.initData) setInitData(launch.initData);
    signalReady();
  }, [launch]);

  if (!isInsideTelegram(launch)) {
    return (
      <main className="screen screen--center">
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
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>
  );
}

function Shell(): JSX.Element {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('today');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [period, setPeriod] = useState<StatsPeriod>('month');
  const [toast, setToast] = useState<string | null>(null);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories });
  const today = useQuery({ queryKey: ['today'], queryFn: api.today });

  const stats = useQuery({
    queryKey: ['stats', period],
    queryFn: () => api.stats(period),
    enabled: tab === 'stats',
  });

  const history = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.transactions({ limit: 100 }),
    enabled: tab === 'history',
  });

  const recurring = useQuery({
    queryKey: ['recurring'],
    queryFn: api.recurringRules,
    enabled: tab === 'settings',
  });

  const goals = useQuery({
    queryKey: ['goals'],
    queryFn: api.savingsGoals,
    enabled: tab === 'settings',
  });

  /** Everything money-related is invalidated together — the figures interlock. */
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['today'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };

  const create = useMutation({
    mutationFn: api.createTransaction,
    onSuccess: (result) => {
      haptics.success();
      setCaptureOpen(false);
      refreshAll();
      const money = formatMoney(result.transaction.amountCents, {
        currency: me.data?.user.currency,
        locale: me.data?.user.locale,
      });
      showToast(
        result.safeToSpend.hasBudget
          ? `Saved ${money} · ${formatMoney(result.safeToSpend.leftForTodayCents, {
              currency: me.data?.user.currency,
              locale: me.data?.user.locale,
            })} left today`
          : `Saved ${money}`,
      );
    },
    onError: () => haptics.error(),
  });

  const remove = useMutation({
    mutationFn: api.deleteTransaction,
    onSuccess: () => {
      haptics.rigid();
      setSelected(null);
      refreshAll();
      showToast('Deleted');
    },
    onError: () => haptics.error(),
  });

  const settings = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      haptics.success();
      refreshAll();
      showToast('Saved');
    },
    onError: () => haptics.error(),
  });

  const addRecurring = useMutation({
    mutationFn: api.createRecurringRule,
    onSuccess: () => {
      haptics.success();
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
      showToast('Recurring transaction added');
    },
    onError: () => haptics.error(),
  });

  const deleteRecurring = useMutation({
    mutationFn: api.deleteRecurringRule,
    onSuccess: () => {
      haptics.rigid();
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
      showToast('Stopped');
    },
    onError: () => haptics.error(),
  });

  // The invite code lives here rather than in the `me` query — it's a
  // one-time secret handed back exactly once, never something to re-fetch.
  const [householdInviteCode, setHouseholdInviteCode] = useState<string | null>(null);

  const createHouseholdInvite = useMutation({
    mutationFn: api.createHouseholdInvite,
    onSuccess: (result) => {
      haptics.success();
      setHouseholdInviteCode(result.code);
      // Creating an invite also creates the household if there wasn't one yet.
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: () => haptics.error(),
  });

  const leaveHousehold = useMutation({
    mutationFn: api.leaveHousehold,
    onSuccess: () => {
      haptics.rigid();
      setHouseholdInviteCode(null);
      // Every scoped total changes shape the moment membership does.
      refreshAll();
      showToast('Left the shared budget');
    },
    onError: () => haptics.error(),
  });

  const addGoal = useMutation({
    mutationFn: api.createSavingsGoal,
    onSuccess: () => {
      haptics.success();
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      showToast('Goal created');
    },
    onError: () => haptics.error(),
  });

  const contributeGoal = useMutation({
    mutationFn: ({ id, amountCents }: { id: string; amountCents: number }) =>
      api.contributeToSavingsGoal(id, { amountCents }),
    onSuccess: () => {
      haptics.success();
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      // A contribution is a real transaction, tagged as a transfer — it shows
      // up in History and Stats even though it never moves safe-to-spend.
      refreshAll();
      showToast('Added to goal');
    },
    onError: () => haptics.error(),
  });

  const archiveGoal = useMutation({
    mutationFn: api.archiveSavingsGoal,
    onSuccess: () => {
      haptics.rigid();
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      showToast('Goal archived');
    },
    onError: () => haptics.error(),
  });

  if (me.isPending || today.isPending) {
    return (
      <main className="screen">
        <div className="card">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton skeleton--short" />
        </div>
      </main>
    );
  }

  if (me.isError || today.isError) {
    const error = (me.error ?? today.error) as unknown;
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Couldn't reach the server. It may be waking up — try again in a moment.";

    return (
      <main className="screen screen--center">
        <div className="empty">
          <div className="empty__emoji">📡</div>
          <div className="empty__title">Not connected</div>
          <p className="empty__body">{message}</p>
          <button
            type="button"
            className="primary primary--inline"
            onClick={() => {
              void me.refetch();
              void today.refetch();
            }}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  const currency = me.data.user.currency;
  const locale = me.data.user.locale;

  return (
    <>
      <main className="app">
        {tab === 'today' && (
          <TodayScreen
            data={today.data}
            onSelectTransaction={setSelected}
            onSetBudget={() => setTab('settings')}
          />
        )}

        {tab === 'stats' && (
          <StatsScreen
            period={period}
            onPeriodChange={setPeriod}
            data={stats.data}
            loading={stats.isPending}
            currency={currency}
            locale={locale}
            today={today.data.today}
          />
        )}

        {tab === 'history' && (
          <HistoryScreen
            transactions={history.data?.transactions ?? []}
            loading={history.isPending}
            currency={currency}
            locale={locale}
            today={today.data.today}
            onSelect={setSelected}
          />
        )}

        {tab === 'settings' && (
          <SettingsScreen
            me={me.data}
            busy={settings.isPending}
            onSaveBudget={(cents) => settings.mutate({ monthlyBudgetCents: cents })}
            onToggleDigest={(enabled) => settings.mutate({ digestEnabled: enabled })}
            onToggleAlerts={(enabled) => settings.mutate({ alertsEnabled: enabled })}
            categories={categories.data?.categories ?? []}
            today={today.data.today}
            recurringRules={recurring.data?.rules ?? []}
            recurringLoading={recurring.isPending}
            recurringBusy={addRecurring.isPending || deleteRecurring.isPending}
            onAddRecurring={(input) => addRecurring.mutate(input)}
            onDeleteRecurring={(id) => deleteRecurring.mutate(id)}
            householdInviteCode={householdInviteCode}
            householdInviteBusy={createHouseholdInvite.isPending}
            householdLeaveBusy={leaveHousehold.isPending}
            onCreateHouseholdInvite={() => createHouseholdInvite.mutate()}
            onLeaveHousehold={() => leaveHousehold.mutate()}
            goals={goals.data?.goals ?? []}
            goalsLoading={goals.isPending}
            goalsBusy={addGoal.isPending || contributeGoal.isPending || archiveGoal.isPending}
            onAddGoal={(input) => addGoal.mutate(input)}
            onContributeGoal={(id, amountCents) => contributeGoal.mutate({ id, amountCents })}
            onArchiveGoal={(id) => archiveGoal.mutate(id)}
          />
        )}
      </main>

      <button
        type="button"
        className="fab"
        aria-label="Add a transaction"
        onClick={() => {
          haptics.press();
          setCaptureOpen(true);
        }}
      >
        +
      </button>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tabs__item ${tab === item.id ? 'tabs__item--on' : ''}`}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => {
              haptics.select();
              setTab(item.id);
            }}
          >
            <span className="tabs__icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      <Sheet open={captureOpen} onClose={() => setCaptureOpen(false)} title="Add a transaction">
        <Capture
          categories={categories.data?.categories ?? []}
          currency={currency}
          locale={locale}
          today={today.data.today}
          busy={create.isPending}
          error={
            create.isError
              ? create.error instanceof ApiRequestError
                ? create.error.message
                : "Couldn't save — tap to retry."
              : null
          }
          onSubmit={(input) => create.mutate(input)}
        />
      </Sheet>

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title="Transaction">
        {selected && (
          <div className="detail">
            <div className="detail__amount">
              {selected.direction === 'in' ? '+' : '−'}
              {formatMoney(selected.amountCents, { currency, locale })}
            </div>
            <div className="detail__meta">
              {selected.categoryEmoji ?? '•'} {selected.categoryName ?? 'Uncategorised'} ·{' '}
              {selected.occurredOn}
            </div>
            {selected.note && <p className="detail__note">{selected.note}</p>}
            <button
              type="button"
              className="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(selected.id)}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </button>
            <p className="detail__hint">
              Deleted entries stop counting immediately and are purged after 30 days.
            </p>
          </div>
        )}
      </Sheet>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
