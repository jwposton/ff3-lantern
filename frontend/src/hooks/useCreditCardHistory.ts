import { useQueries, useQuery } from "@tanstack/react-query"

import {
  fetchCreditCardHistory,
  type CreditCardHistoryEnvelope,
} from "@/lib/paymentRunApi"

export type HistoryDateRange = { start: string; end: string }

export function creditCardHistoryQueryKey(
  accountId: string,
  range?: HistoryDateRange,
) {
  return [
    "paymentRun",
    "creditCardHistory",
    accountId,
    range?.start,
    range?.end,
  ] as const
}

export function useCreditCardHistory(
  accountId: string | null,
  range: HistoryDateRange,
) {
  return useQuery({
    queryKey: creditCardHistoryQueryKey(accountId ?? "", range),
    queryFn: () => fetchCreditCardHistory(accountId!, range),
    enabled: accountId != null && accountId !== "",
    staleTime: 1000 * 60 * 2,
  })
}

export function useCreditCardPortfolioHistories(
  accountIds: string[],
  range: HistoryDateRange,
) {
  return useQueries({
    queries: accountIds.map((accountId) => ({
      queryKey: creditCardHistoryQueryKey(accountId, range),
      queryFn: () => fetchCreditCardHistory(accountId, range),
      enabled: accountIds.length > 0,
      staleTime: 1000 * 60 * 2,
    })),
  })
}

export type { CreditCardHistoryEnvelope }
