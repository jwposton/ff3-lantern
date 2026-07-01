import { useQuery } from "@tanstack/react-query"

import { fetchPendingLoanSplits } from "@/lib/loanApi"
import { isValidRange } from "@/lib/dateRange"

export function useLoanSplitsQueue(start: string, end: string) {
  const rangeValid = Boolean(start && end && isValidRange(start, end))

  return useQuery({
    queryKey: ["loanSplitsQueue", start, end],
    queryFn: () => fetchPendingLoanSplits(start, end),
    enabled: rangeValid,
    staleTime: 1000 * 60 * 2,
  })
}
