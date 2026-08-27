import type { ApiError, CategoriesResponse, MeResponse } from '@spendlygo/shared';

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

async function request<T>(path: string, initData: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      // Telegram's convention for authenticating Mini App requests.
      Authorization: `tma ${initData}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    let code = 'http_error';
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as ApiError;
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new ApiRequestError(response.status, code, message);
  }

  return (await response.json()) as T;
}

export const api = {
  me: (initData: string) => request<MeResponse>('/api/me', initData),
  categories: (initData: string) => request<CategoriesResponse>('/api/categories', initData),
};
