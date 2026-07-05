import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  fetchDiscoverSettings,
  ignoreDiscoverCategory,
  ignoreDiscoverPayee,
  updateDiscoverSettings,
  type DiscoverSettingsEnvelope,
  type DiscoverSettingsUpdate,
} from "@/lib/paymentRunApi"
import { billSuggestionsQueryKey } from "@/hooks/useBillSuggestions"

export function discoverSettingsQueryKey() {
  return ["paymentRun", "discoverSettings"] as const
}

function mergeDiscoverSettings(
  prev: DiscoverSettingsEnvelope | undefined,
  data: Partial<DiscoverSettingsEnvelope>,
): DiscoverSettingsEnvelope {
  return {
    ignored_categories: data.ignored_categories ?? prev?.ignored_categories ?? [],
    ignored_payees: data.ignored_payees ?? prev?.ignored_payees ?? [],
    available_categories: prev?.available_categories ?? [],
    suggested_ignored_categories: prev?.suggested_ignored_categories,
  }
}

function invalidateDiscoverSuggestions(
  queryClient: ReturnType<typeof useQueryClient>,
  lookbackMonths: number,
) {
  void queryClient.invalidateQueries({
    queryKey: billSuggestionsQueryKey(lookbackMonths),
  })
  queryClient.removeQueries({
    queryKey: ["paymentRun", "billSuggestionTransactions"],
  })
}

export function useDiscoverSettings() {
  return useQuery({
    queryKey: discoverSettingsQueryKey(),
    queryFn: fetchDiscoverSettings,
    staleTime: 1000 * 60 * 5,
  })
}

export function useUpdateDiscoverSettings(lookbackMonths?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: DiscoverSettingsUpdate) => updateDiscoverSettings(body),
    onSuccess: (data) => {
      queryClient.setQueryData(
        discoverSettingsQueryKey(),
        (prev: DiscoverSettingsEnvelope | undefined) =>
          mergeDiscoverSettings(prev, data),
      )
      if (lookbackMonths !== undefined) {
        invalidateDiscoverSuggestions(queryClient, lookbackMonths)
      }
    },
  })
}

export function useIgnorePayee(lookbackMonths: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (suggestionId: string) =>
      ignoreDiscoverPayee(suggestionId, lookbackMonths),
    onSuccess: (data) => {
      queryClient.setQueryData(
        discoverSettingsQueryKey(),
        (prev: DiscoverSettingsEnvelope | undefined) =>
          mergeDiscoverSettings(prev, { ignored_payees: data.ignored_payees }),
      )
      invalidateDiscoverSuggestions(queryClient, lookbackMonths)
    },
  })
}

export function useIgnoreCategory(lookbackMonths: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (category: string) => ignoreDiscoverCategory(category),
    onSuccess: (data) => {
      queryClient.setQueryData(
        discoverSettingsQueryKey(),
        (prev: DiscoverSettingsEnvelope | undefined) =>
          mergeDiscoverSettings(prev, {
            ignored_categories: data.ignored_categories,
          }),
      )
      invalidateDiscoverSuggestions(queryClient, lookbackMonths)
    },
  })
}
