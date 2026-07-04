import { useQuery } from "@tanstack/react-query"

import {
  fetchBillSuggestionTransactions,
  type BillSuggestionTransactionsEnvelope,
} from "@/lib/paymentRunApi"

export function billSuggestionTransactionsQueryKey(
  suggestionId: string,
  lookbackMonths: number,
) {
  return [
    "paymentRun",
    "billSuggestionTransactions",
    suggestionId,
    lookbackMonths,
  ] as const
}

export function useBillSuggestionTransactions(
  suggestionId: string | null,
  lookbackMonths: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: billSuggestionTransactionsQueryKey(
      suggestionId ?? "",
      lookbackMonths,
    ),
    queryFn: () =>
      fetchBillSuggestionTransactions(suggestionId as string, lookbackMonths),
    staleTime: 120000,
    enabled: enabled && suggestionId != null,
  })
}

export type { BillSuggestionTransactionsEnvelope }
