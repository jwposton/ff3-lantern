import { useQueries, useQuery } from "@tanstack/react-query"

import {
  fetchLiabilityHistory,
  type LiabilityHistoryEnvelope,
} from "@/lib/paymentRunApi"

export function liabilityHistoryQueryKey(accountId: string) {
  return ["paymentRun", "liabilityHistory", accountId] as const
}

export function useLiabilityHistory(accountId: string | null) {
  return useQuery({
    queryKey: liabilityHistoryQueryKey(accountId ?? ""),
    queryFn: () => fetchLiabilityHistory(accountId!),
    enabled: accountId != null && accountId !== "",
    staleTime: 1000 * 60 * 2,
  })
}

export function useLiabilityPortfolioHistories(accountIds: string[]) {
  return useQueries({
    queries: accountIds.map((accountId) => ({
      queryKey: liabilityHistoryQueryKey(accountId),
      queryFn: () => fetchLiabilityHistory(accountId),
      enabled: accountIds.length > 0,
      staleTime: 1000 * 60 * 2,
    })),
  })
}

export type { LiabilityHistoryEnvelope }
