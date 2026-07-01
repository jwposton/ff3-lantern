import { useDateRange } from "@/context/DateRangeContext"
import { useCategorizeQueue } from "@/hooks/useCategorizeQueue"
import { useLoanSplitsQueue } from "@/hooks/useLoanSplitsQueue"

export type ManageQueueCounts = {
  categorizeCount: number
  loanSplitCount: number
  isLoading: boolean
}

export function useManageQueueCounts(): ManageQueueCounts {
  const { committedRange } = useDateRange()
  const categorizeQuery = useCategorizeQueue(
    committedRange.start,
    committedRange.end,
  )
  const loanSplitsQuery = useLoanSplitsQueue(
    committedRange.start,
    committedRange.end,
  )

  return {
    categorizeCount: categorizeQuery.data?.meta?.count ?? 0,
    loanSplitCount: loanSplitsQuery.data?.meta?.count ?? 0,
    isLoading: categorizeQuery.isPending || loanSplitsQuery.isPending,
  }
}
