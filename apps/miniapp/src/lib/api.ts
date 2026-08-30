import type {
  CategoriesResponse,
  CreateTransactionBody,
  MeResponse,
  SafeToSpend,
  StatsResponse,
  TodayResponse,
  Transaction,
  TransactionsResponse,
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
};
