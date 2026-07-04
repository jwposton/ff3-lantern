import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"

import { MassEditBar } from "@/components/MassEditBar"
import { TransactionFilters } from "@/components/TransactionFilters"
import { TransactionTable } from "@/components/TransactionTable"
import { Button } from "@/components/ui/button"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import {
  applyMassEdit,
  fetchTransactionsMeta,
} from "@/lib/transactionsApi"
import { parseExplorerFiltersFromSearchParams } from "@/lib/explorerFilterUrl"
import {
  applyDefaultTypeScope,
  applyFilters,
  distinctBudgets,
  distinctCategories,
  distinctSourceAccounts,
  EMPTY_FILTERS,
  isRowEditable,
  paginateRows,
  rowKey,
  sortRows,
  type FilterState,
  type SortDir,
  type SortKey,
} from "@/lib/transactionTable"
import type { OmniRow } from "@/types/NormalizedTransaction"

const MAX_MASS_EDIT = 500

export function TransactionExplorerPage() {
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(committedStart, committedEnd)

  const metaQuery = useQuery({
    queryKey: ["transactionsMeta"],
    queryFn: fetchTransactionsMeta,
  })

  const [showAllTypes, setShowAllTypes] = useState(true)
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [pageIndex, setPageIndex] = useState(0)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [categoryId, setCategoryId] = useState("")
  const [budgetMode, setBudgetMode] = useState<"unchanged" | "set" | "clear">(
    "unchanged",
  )
  const [budgetId, setBudgetId] = useState("")
  const [applying, setApplying] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  useEffect(() => {
    const parsed = parseExplorerFiltersFromSearchParams(searchParams)
    if (parsed.fromUrl) {
      setFilters(parsed.filters)
      setShowAllTypes(parsed.showAllTypes)
      setPageIndex(0)
    }
  }, [searchParams])

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
  const rowByKey = useMemo(() => {
    const map = new Map<string, OmniRow>()
    for (const row of sortedRows) {
      if (isRowEditable(row)) {
        map.set(rowKey(row), row)
      }
    }
    return map
  }, [sortedRows])

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(key === "date" ? "desc" : "asc")
    }
  }

  function toggleRow(key: string, selected: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (selected) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function togglePage(keys: string[], selected: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      for (const key of keys) {
        if (selected) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  function selectAllMatching() {
    const keys = [...rowByKey.keys()]
    if (keys.length > MAX_MASS_EDIT) {
      setApplyError(`Cannot select more than ${MAX_MASS_EDIT} rows at once.`)
      return
    }
    setApplyError(null)
    setSelectedKeys(new Set(keys))
  }

  async function handleConfirmApply() {
    const targets = [...selectedKeys]
      .map((key) => rowByKey.get(key))
      .filter((row): row is OmniRow => row != null)
      .map((row) => ({
        journal_id: row.journal_id!,
        transaction_journal_id: row.transaction_journal_id!,
      }))

    if (targets.length === 0) return
    if (targets.length > MAX_MASS_EDIT) {
      setApplyError(`Cannot apply more than ${MAX_MASS_EDIT} rows at once.`)
      return
    }

    setApplying(true)
    setApplyError(null)
    try {
      const result = await applyMassEdit({
        targets,
        category_id: categoryId || null,
        budget_id: budgetMode === "set" ? budgetId || null : null,
        clear_budget: budgetMode === "clear",
      })
      if (result.failed > 0) {
        setApplyError(
          `Applied ${result.applied}; ${result.failed} failed. ${result.errors[0]?.error ?? ""}`,
        )
      } else {
        setSelectedKeys(new Set())
        setConfirmOpen(false)
        setCategoryId("")
        setBudgetMode("unchanged")
        setBudgetId("")
        await queryClient.invalidateQueries({
          queryKey: ["normalizedTransactions", committedStart, committedEnd],
        })
      }
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Mass edit failed")
    } finally {
      setApplying(false)
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Transaction Explorer
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Filter transactions, select rows, and bulk-update category or budget.
        </p>
      </div>

      <TransactionFilters
        filters={filters}
        onChange={setFilters}
        options={filterOptions}
        showAllTypes={showAllTypes}
        onShowAllTypesChange={setShowAllTypes}
        disabled={controlsDisabled}
      />

      {!metaQuery.isError && metaQuery.data ? (
        <MassEditBar
          selectedCount={selectedKeys.size}
          matchingCount={rowByKey.size}
          categories={metaQuery.data.categories}
          budgets={metaQuery.data.budgets}
          categoryId={categoryId}
          budgetMode={budgetMode}
          budgetId={budgetId}
          applying={applying}
          confirmOpen={confirmOpen}
          error={applyError}
          onCategoryChange={setCategoryId}
          onBudgetModeChange={setBudgetMode}
          onBudgetChange={setBudgetId}
          onSelectAllMatching={selectAllMatching}
          onClearSelection={() => setSelectedKeys(new Set())}
          onApplyClick={() => {
            setApplyError(null)
            setConfirmOpen(true)
          }}
          onConfirmApply={() => {
            void handleConfirmApply()
          }}
          onCancelConfirm={() => setConfirmOpen(false)}
        />
      ) : null}

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
            onClick={() => {
              setFilters(EMPTY_FILTERS)
              setShowAllTypes(true)
            }}
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
            fireflyBaseUrl={data?.firefly_base_url}
            selectionEnabled
            selectedKeys={selectedKeys}
            onToggleRow={toggleRow}
            onTogglePage={togglePage}
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
