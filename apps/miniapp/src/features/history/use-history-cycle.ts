import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { addDays } from '../../lib/format';

export interface HistoryCycle {
  /** "20 Oct – 19 Nov", from /api/stats (the server owns the cycle maths). */
  label: string | undefined;
  from: string | undefined;
  /** Clamped to today so the current cycle never asks for future dates. */
  to: string | undefined;
  canGoNext: boolean;
  /** The day before `from` / after `to`: the anchors /api/stats resolves to the neighbouring cycles. */
  prevAnchor: string | undefined;
  nextAnchor: string | undefined;
  isPending: boolean;
  isError: boolean;
  retry: () => void;
}

/**
 * History's "Cycle" chip (F17, B-032 P2): reuses GET /api/stats?period=month&anchor=
 * which already returns the cycle's from/to/label. Only fetched when the chip is
 * in use (start day other than 1).
 */
export function useHistoryCycle(options: {
  enabled: boolean;
  /** undefined = the current cycle. */
  anchor: string | undefined;
  today: string | undefined;
}): HistoryCycle {
  const { enabled, anchor, today } = options;
  // Key moves to lib/query-keys.ts in B-017. Starts with 'stats' so the existing
  // ['stats'] invalidation refreshes it.
  const query = useQuery({
    queryKey: ['stats', 'month', anchor ?? 'current'],
    queryFn: () => api.stats('month', anchor),
    enabled,
  });

  const data = query.data;
  const to = data && today && data.to > today ? today : data?.to;
  return {
    label: data?.label,
    from: data?.from,
    to,
    canGoNext: data !== undefined && today !== undefined && data.to < today,
    prevAnchor: data ? addDays(data.from, -1) : undefined,
    nextAnchor: data ? addDays(data.to, 1) : undefined,
    isPending: query.isPending,
    isError: query.isError,
    retry: () => void query.refetch(),
  };
}
