import { useQueries, useQuery } from "@tanstack/react-query"

import {
  fetchCreditCardHistory,
  type CreditCardHistoryEnvelope,
} from "@/lib/paymentRunApi"

export function creditCardHistoryQueryKey(accountId: string) {
  return ["paymentRun", "creditCardHistory", accountId] as const
}

export function useCreditCardHistory(accountId: string | null) {
  return useQuery({
    queryKey: creditCardHistoryQueryKey(accountId ?? ""),
    queryFn: () => fetchCreditCardHistory(accountId!),
    enabled: accountId != null && accountId !== "",
    staleTime: 1000 * 60 * 2,
  })
}

export function useCreditCardPortfolioHistories(accountIds: string[]) {
  return useQueries({
    queries: accountIds.map((accountId) => ({
      queryKey: creditCardHistoryQueryKey(accountId),
      queryFn: () => fetchCreditCardHistory(accountId),
      enabled: accountIds.length > 0,
      staleTime: 1000 * 60 * 2,
    })),
  })
}

export type { CreditCardHistoryEnvelope }
