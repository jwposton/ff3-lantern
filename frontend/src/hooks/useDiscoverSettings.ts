import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  fetchDiscoverSettings,
  updateDiscoverSettings,
  type DiscoverSettingsEnvelope,
} from "@/lib/paymentRunApi"
import { billSuggestionsQueryKey } from "@/hooks/useBillSuggestions"

export function discoverSettingsQueryKey() {
  return ["paymentRun", "discoverSettings"] as const
}

export function useDiscoverSettings() {
  return useQuery({
    queryKey: discoverSettingsQueryKey(),
    queryFn: fetchDiscoverSettings,
    staleTime: 1000 * 60 * 5,
  })
}

export function useUpdateDiscoverSettings(lookbackMonths: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ignoredCategories: string[]) =>
      updateDiscoverSettings(ignoredCategories),
    onSuccess: (data) => {
      queryClient.setQueryData(
        discoverSettingsQueryKey(),
        (prev: DiscoverSettingsEnvelope | undefined) => ({
          ignored_categories: data.ignored_categories,
          available_categories: prev?.available_categories ?? [],
        }),
      )
      void queryClient.invalidateQueries({
        queryKey: billSuggestionsQueryKey(lookbackMonths),
      })
    },
  })
}
