import { useQuery } from "@tanstack/react-query"

import { fetchPending } from "@/lib/categorizeApi"
import { isValidRange } from "@/lib/dateRange"

export function useCategorizeQueue(start: string, end: string) {
  const rangeValid = Boolean(start && end && isValidRange(start, end))

  return useQuery({
    queryKey: ["categorizeQueue", start, end],
    queryFn: () => fetchPending(start, end),
    enabled: rangeValid,
    staleTime: 1000 * 60 * 2,
  })
}

export function useCategorizeGroupedQueue(start: string, end: string) {
  const rangeValid = Boolean(start && end && isValidRange(start, end))

  return useQuery({
    queryKey: ["categorizeQueue", "grouped", start, end],
    queryFn: () => fetchPending(start, end, { groupByFingerprint: true }),
    enabled: rangeValid,
    staleTime: 1000 * 60 * 2,
  })
}
