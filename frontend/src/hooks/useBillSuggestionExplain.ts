import { useQuery } from "@tanstack/react-query"

import {
  explainBillSuggestion,
  type BillSuggestionExplainResponse,
} from "@/lib/paymentRunApi"

export function billSuggestionExplainQueryKey(
  suggestionId: string,
  lookbackMonths: number,
) {
  return [
    "paymentRun",
    "billSuggestionExplain",
    suggestionId,
    lookbackMonths,
  ] as const
}

export function useBillSuggestionExplain(
  suggestionId: string | null,
  lookbackMonths: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: billSuggestionExplainQueryKey(
      suggestionId ?? "",
      lookbackMonths,
    ),
    queryFn: () =>
      explainBillSuggestion(suggestionId as string, lookbackMonths),
    staleTime: 0,
    enabled: enabled && suggestionId != null,
  })
}

export type { BillSuggestionExplainResponse }
