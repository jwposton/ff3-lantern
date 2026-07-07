import { useQueries, useQuery } from "@tanstack/react-query"

import {
  fetchLiabilityHistory,
  type LiabilityHistoryEnvelope,
} from "@/lib/paymentRunApi"

export type HistoryDateRange = { start: string; end: string }

export function liabilityHistoryQueryKey(
  accountId: string,
  range?: HistoryDateRange,
) {
  return [
    "paymentRun",
    "liabilityHistory",
    accountId,
    range?.start,
    range?.end,
  ] as const
}

export function useLiabilityHistory(
  accountId: string | null,
  range: HistoryDateRange,
) {
  return useQuery({
    queryKey: liabilityHistoryQueryKey(accountId ?? "", range),
    queryFn: () => fetchLiabilityHistory(accountId!, range),
    enabled: accountId != null && accountId !== "",
    staleTime: 1000 * 60 * 2,
  })
}

export function useLiabilityPortfolioHistories(
  accountIds: string[],
  range: HistoryDateRange,
) {
  return useQueries({
    queries: accountIds.map((accountId) => ({
      queryKey: liabilityHistoryQueryKey(accountId, range),
      queryFn: () => fetchLiabilityHistory(accountId, range),
      enabled: accountIds.length > 0,
      staleTime: 1000 * 60 * 2,
    })),
  })
}

export type { LiabilityHistoryEnvelope }
