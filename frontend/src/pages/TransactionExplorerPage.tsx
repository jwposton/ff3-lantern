import { useEffect, useMemo, useState } from "react"

import { TransactionFilters } from "@/components/TransactionFilters"
import { TransactionTable } from "@/components/TransactionTable"
import { Button } from "@/components/ui/button"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import {
  applyDefaultTypeScope,
  applyFilters,
  distinctBudgets,
  distinctCategories,
  distinctSourceAccounts,
  EMPTY_FILTERS,
  paginateRows,
  sortRows,
  type FilterState,
  type SortDir,
  type SortKey,
} from "@/lib/transactionTable"

export function TransactionExplorerPage() {
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(committedStart, committedEnd)

  const [showAllTypes, setShowAllTypes] = useState(false)
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => {
    setPageIndex(0)
  }, [
    committedStart,
    committedEnd,
    sortKey,
    sortDir,
    showAllTypes,
    filters,
  ])

  const allRows = isSuccess ? (data?.data ?? []) : []

  const scopedRows = useMemo(
    () => applyDefaultTypeScope(allRows, showAllTypes),
    [allRows, showAllTypes],
  )

  const filterOptions = useMemo(
    () => ({
      categories: distinctCategories(scopedRows),
      budgets: distinctBudgets(scopedRows),
      accounts: distinctSourceAccounts(scopedRows),
    }),
    [scopedRows],
  )

  const filteredRows = useMemo(
    () => applyFilters(scopedRows, filters),
    [scopedRows, filters],
  )

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortKey, sortDir),
    [filteredRows, sortKey, sortDir],
  )

  const { pageRows, totalPages } = useMemo(
    () => paginateRows(sortedRows, pageIndex),
    [sortedRows, pageIndex],
  )

  const totalCount = sortedRows.length

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
    scopedRows.length === 0 &&
    !isPending &&
    !isError
  const filteredEmpty =
    isSuccess &&
    scopedRows.length > 0 &&
    filteredRows.length === 0 &&
    !isPending &&
    !isError

  const controlsDisabled = isPending || isError

  return (
    <div className="space-y-6 px-0 lg:px-0">
      <h1 className="text-2xl font-semibold tracking-tight">
        Transaction Explorer
      </h1>

      <TransactionFilters
        filters={filters}
        onChange={setFilters}
        options={filterOptions}
        showAllTypes={showAllTypes}
        onShowAllTypesChange={setShowAllTypes}
        disabled={controlsDisabled}
      />

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
      ) : rangeEmpty ? (
        <p className="text-sm text-muted-foreground">
          No transactions in this date range.
        </p>
      ) : scopedEmpty ? (
        <p className="text-sm text-muted-foreground">
          No transactions in this date range.
        </p>
      ) : filteredEmpty ? (
        <div className="space-y-3 rounded-lg border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No transactions match your filters
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Clear all filters
          </Button>
        </div>
      ) : (
        <>
          <TransactionTable
            rows={pageRows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            isLoading={isPending}
            showAllTypes={showAllTypes}
            fireflyBaseUrl={data?.firefly_base_url}
          />
          {totalPages > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-4 text-xs font-medium text-muted-foreground">
              <span>
                Page {pageIndex + 1} of {totalPages} · {totalCount}{" "}
                transactions
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pageIndex <= 0 || controlsDisabled}
                  onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pageIndex >= totalPages - 1 || controlsDisabled}
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
