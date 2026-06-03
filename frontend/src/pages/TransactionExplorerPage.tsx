import { useEffect, useMemo, useState } from "react"

import { TransactionTable } from "@/components/TransactionTable"
import { Button } from "@/components/ui/button"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import {
  applyDefaultTypeScope,
  paginateRows,
  sortRows,
  type SortDir,
  type SortKey,
} from "@/lib/transactionTable"

export function TransactionExplorerPage() {
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(committedStart, committedEnd)

  const [showAllTypes, setShowAllTypes] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => {
    setPageIndex(0)
  }, [committedStart, committedEnd, sortKey, sortDir])

  const allRows = isSuccess ? (data?.data ?? []) : []

  const displayRows = useMemo(() => {
    const scoped = applyDefaultTypeScope(allRows, showAllTypes)
    const sorted = sortRows(scoped, sortKey, sortDir)
    return paginateRows(sorted, pageIndex).pageRows
  }, [allRows, showAllTypes, sortKey, sortDir, pageIndex])

  const { totalPages, totalCount } = useMemo(() => {
    const scoped = applyDefaultTypeScope(allRows, showAllTypes)
    const sorted = sortRows(scoped, sortKey, sortDir)
    const { totalPages: pages } = paginateRows(sorted, pageIndex)
    return { totalPages: pages, totalCount: sorted.length }
  }, [allRows, showAllTypes, sortKey, sortDir, pageIndex])

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(key === "date" ? "desc" : "asc")
    }
  }

  const rangeEmpty =
    isSuccess && allRows.length === 0 && !isPending && !isError
  const scopedEmpty =
    isSuccess &&
    allRows.length > 0 &&
    applyDefaultTypeScope(allRows, showAllTypes).length === 0

  return (
    <div className="space-y-6 px-0 lg:px-0">
      <h1 className="text-2xl font-semibold tracking-tight">
        Transaction Explorer
      </h1>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={showAllTypes}
          disabled
          onChange={(e) => setShowAllTypes(e.target.checked)}
          className="rounded border"
        />
        Show all types (filters in next release)
      </label>

      {isError ? (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
          role="alert"
        >
          <h2 className="text-sm font-semibold text-destructive">
            Unable to load transactions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Check that the backend is running and Firefly credentials are
            configured.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              void refetch()
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {rangeEmpty ? (
        <p className="text-sm text-muted-foreground">
          No transactions in this date range.
        </p>
      ) : scopedEmpty ? (
        <p className="text-sm text-muted-foreground">
          No transactions match your filters
        </p>
      ) : (
        <>
          <TransactionTable
            rows={displayRows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            isLoading={isPending}
            showAllTypes={showAllTypes}
          />
          {totalPages > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-4 text-xs font-medium text-muted-foreground">
              <span>
                Page {pageIndex + 1} of {totalPages} · {totalCount} transactions
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pageIndex <= 0 || isPending}
                  onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pageIndex >= totalPages - 1 || isPending}
                  onClick={() => setPageIndex((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
