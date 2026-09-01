import type {
  CategoriesResponse,
  ContributeToGoalBody,
  CreateRecurringRuleBody,
  CreateSavingsGoalBody,
  CreateTransactionBody,
  HouseholdInviteResponse,
  HouseholdResponse,
  MeResponse,
  PhotosResponse,
  RecapPeriod,
  RecapResponse,
  RecurringRulesResponse,
  SafeToSpend,
  SavingsGoalResponse,
  SavingsGoalsResponse,
  SpacesResponse,
  StatsResponse,
  TodayResponse,
  Transaction,
  TransactionsResponse,
  UpdateSavingsGoalBody,
  UpdateSettingsBody,
} from '@spendlygo/shared';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

let initData = '';

/** Set once at boot from the Telegram launch parameters. */
export function setInitData(value: string): void {
  initData = value;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      // Telegram's convention for authenticating Mini App requests. The server
      // verifies its signature — nothing here is trusted.
      Authorization: `tma ${initData}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    let code = 'http_error';
    let message = `Something went wrong (${response.status})`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* Non-JSON error body; the generic message stands. */
    }
    throw new ApiRequestError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * A receipt photo, authenticated. `<img src>` can't set an Authorization
 * header, so this fetches the bytes itself and hands back a local blob URL —
 * `URL.revokeObjectURL` it once the viewer using it unmounts.
 */
async function fetchPhotoBlobUrl(id: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/photos/${id}`, {
    headers: { Authorization: `tma ${initData}` },
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, 'photo_unavailable', 'Photo is not available.');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Downloads the CSV export (PRD F8) and saves it. A plain `<a href>` can't
 * carry the Authorization header, so this fetches the bytes itself and
 * triggers the save through a throwaway anchor, exactly like the photo
 * viewer fetches its own blob URL above.
 */
async function downloadExportCsv(range?: string): Promise<void> {
  const suffix = range ? `?range=${encodeURIComponent(range)}` : '';
  const response = await fetch(`${BASE_URL}/api/export${suffix}`, {
    headers: { Authorization: `tma ${initData}` },
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, 'export_unavailable', 'Export is not available.');
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'spendlygo-export.csv';

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface MutationResult {
  transaction: Transaction;
  safeToSpend: SafeToSpend;
}

export const api = {
  me: () => request<MeResponse>('/api/me'),
  categories: () => request<CategoriesResponse>('/api/categories'),
  today: () => request<TodayResponse>('/api/today'),

  stats: (period: 'day' | 'month' | 'year', anchor?: string) =>
    request<StatsResponse>(`/api/stats?period=${period}${anchor ? `&anchor=${anchor}` : ''}`),

  recap: (period: RecapPeriod, anchor?: string) =>
    request<RecapResponse>(`/api/recap?period=${period}${anchor ? `&anchor=${anchor}` : ''}`),

  transactionPhotos: (transactionId: string) =>
    request<PhotosResponse>(`/api/transactions/${transactionId}/photos`),

  photoBlobUrl: fetchPhotoBlobUrl,

  exportCsv: downloadExportCsv,

  transactions: (params: { from?: string; to?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.toString();
    return request<TransactionsResponse>(`/api/transactions${suffix ? `?${suffix}` : ''}`);
  },

  createTransaction: (body: CreateTransactionBody) =>
    request<MutationResult>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateTransaction: (id: string, body: Partial<CreateTransactionBody>) =>
    request<MutationResult>(`/api/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteTransaction: (id: string) =>
    request<{ ok: true; safeToSpend: SafeToSpend }>(`/api/transactions/${id}`, {
      method: 'DELETE',
    }),

  updateSettings: (body: UpdateSettingsBody) =>
    request<{ user: Record<string, unknown> }>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  recurringRules: () => request<RecurringRulesResponse>('/api/recurring'),

  createRecurringRule: (body: CreateRecurringRuleBody) =>
    request<{ rule: RecurringRulesResponse['rules'][number] }>('/api/recurring', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteRecurringRule: (id: string) =>
    request<{ ok: true }>(`/api/recurring/${id}`, { method: 'DELETE' }),

  household: () => request<HouseholdResponse>('/api/household'),

  createHouseholdInvite: () =>
    request<HouseholdInviteResponse>('/api/household/invite', { method: 'POST' }),

  leaveHousehold: () => request<{ ok: true }>('/api/household/leave', { method: 'POST' }),

  spaces: () => request<SpacesResponse>('/api/spaces'),

  switchSpace: (householdId: string) =>
    request<{ ok: true }>('/api/spaces/switch', {
      method: 'POST',
      body: JSON.stringify({ householdId }),
    }),

  savingsGoals: () => request<SavingsGoalsResponse>('/api/goals'),

  createSavingsGoal: (body: CreateSavingsGoalBody) =>
    request<SavingsGoalResponse>('/api/goals', { method: 'POST', body: JSON.stringify(body) }),

  updateSavingsGoal: (id: string, body: UpdateSavingsGoalBody) =>
    request<SavingsGoalResponse>(`/api/goals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  archiveSavingsGoal: (id: string) =>
    request<{ ok: true }>(`/api/goals/${id}`, { method: 'DELETE' }),

  contributeToSavingsGoal: (
    id: string,
    body: Omit<ContributeToGoalBody, 'direction'> & {
      direction?: ContributeToGoalBody['direction'];
    },
  ) =>
    request<SavingsGoalResponse>(`/api/goals/${id}/contribute`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
