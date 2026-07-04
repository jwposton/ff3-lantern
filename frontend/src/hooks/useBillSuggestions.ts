import { useQuery } from "@tanstack/react-query"

import {
  fetchBillSuggestions,
  type BillSuggestionsEnvelope,
} from "@/lib/paymentRunApi"

export function billSuggestionsQueryKey(lookbackMonths: number) {
  return ["paymentRun", "billSuggestions", lookbackMonths] as const
}

export function useBillSuggestions(lookbackMonths: number) {
  return useQuery({
    queryKey: billSuggestionsQueryKey(lookbackMonths),
    queryFn: () => fetchBillSuggestions(lookbackMonths),
    staleTime: 1000 * 60 * 2,
  })
}

export type { BillSuggestionsEnvelope }
