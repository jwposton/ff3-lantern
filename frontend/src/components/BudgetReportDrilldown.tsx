import { useEffect, useMemo, useState } from "react"

import { BudgetDrilldownChart } from "@/components/BudgetDrilldownChart"
import { DrilldownFireflyLink } from "@/components/DrilldownFireflyLink"
import { TransactionTable } from "@/components/TransactionTable"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { OmniRow } from "@/types/NormalizedTransaction"
import { filterRowsForDrilldown } from "@/lib/barChart"
import {
  buildDrilldownFireflySearch,
  openFireflySearch,
} from "@/lib/fireflySearch"
import {
  paginateRows,
  sortRows,
  type SortDir,
  type SortKey,
} from "@/lib/transactionTable"

export type BudgetReportDrilldownProps = {
  rows: OmniRow[]
  start: string
  end: string
  budget: string
  chartType: "bar" | "line"
  useCashFlowLabels?: boolean
  yAxisName: string
  fireflyBaseUrl?: string
  onClearBudget: () => void
}

export function BudgetReportDrilldown({
  rows,
  start,
  end,
  budget,
  chartType,
  useCashFlowLabels = false,
  yAxisName,
  fireflyBaseUrl,
  onClearBudget,
}: BudgetReportDrilldownProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedPayee, setSelectedPayee] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => {
    setSelectedCategory(null)
    setSelectedPayee(null)
    setPageIndex(0)
  }, [budget, start, end])

  useEffect(() => {
    setSelectedPayee(null)
    setPageIndex(0)
  }, [selectedCategory])

  useEffect(() => {
    setPageIndex(0)
  }, [selectedPayee, sortKey, sortDir])

  const tableFilter = useMemo(
    () => ({
      budget,
      ...(selectedCategory != null ? { category: selectedCategory } : {}),
      ...(selectedPayee != null ? { payee: selectedPayee } : {}),
    }),
    [budget, selectedCategory, selectedPayee],
  )

  const tableRows = useMemo(
    () => filterRowsForDrilldown(rows, tableFilter, useCashFlowLabels),
    [rows, tableFilter, useCashFlowLabels],
  )

  const sortedRows = useMemo(
    () => sortRows(tableRows, sortKey, sortDir),
    [tableRows, sortKey, sortDir],
  )

  const { pageRows, totalPages } = useMemo(
    () => paginateRows(sortedRows, pageIndex),
    [sortedRows, pageIndex],
  )

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const scopeFireflySearch = buildDrilldownFireflySearch(start, end, {
    budget,
    ...(selectedCategory != null ? { category: selectedCategory } : {}),
    ...(selectedPayee != null ? { payee: selectedPayee } : {}),
    useCashFlowLabels,
  })

  const budgetFireflySearch = buildDrilldownFireflySearch(start, end, {
    budget,
    useCashFlowLabels,
  })

  const categoryFireflySearch =
    selectedCategory != null
      ? buildDrilldownFireflySearch(start, end, {
          budget,
          category: selectedCategory,
          useCashFlowLabels,
        })
      : ""

  const payeeFireflySearch =
    selectedPayee != null
      ? buildDrilldownFireflySearch(start, end, {
          budget,
          category: selectedCategory ?? undefined,
          payee: selectedPayee,
          useCashFlowLabels,
        })
      : ""

  return (
    <div className="space-y-8">
      <BudgetDrilldownChart
        rows={rows}
        start={start}
        end={end}
        budget={budget}
        stackField="category"
        chartType={chartType}
        useCashFlowLabels={useCashFlowLabels}
        yAxisName={yAxisName}
        onSelect={setSelectedCategory}
        onClear={onClearBudget}
        clearAriaLabel="Clear budget drilldown"
      />

      {selectedCategory != null && (
        <BudgetDrilldownChart
          rows={rows}
          start={start}
          end={end}
          budget={budget}
          category={selectedCategory}
          stackField="payee"
          chartType={chartType}
          useCashFlowLabels={useCashFlowLabels}
          yAxisName={yAxisName}
          onSelect={setSelectedPayee}
          onClear={() => {
            setSelectedCategory(null)
            setSelectedPayee(null)
          }}
          clearAriaLabel="Clear category drilldown"
        />
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <CardTitle className="text-base">
            Transactions
            <span className="ml-2 font-normal text-muted-foreground">
              ({tableRows.length}) —
            </span>
            <span className="ml-1 inline-flex flex-wrap items-center gap-1 font-normal text-muted-foreground">
              <DrilldownFireflyLink
                fireflyBaseUrl={fireflyBaseUrl}
                filters={budgetFireflySearch}
              >
                {budget}
              </DrilldownFireflyLink>
              {selectedCategory != null && (
                <>
                  <span aria-hidden>→</span>
                  <DrilldownFireflyLink
                    fireflyBaseUrl={fireflyBaseUrl}
                    filters={categoryFireflySearch}
                  >
                    {selectedCategory}
                  </DrilldownFireflyLink>
                </>
              )}
              {selectedPayee != null && (
                <>
                  <span aria-hidden>→</span>
                  <DrilldownFireflyLink
                    fireflyBaseUrl={fireflyBaseUrl}
                    filters={payeeFireflySearch}
                  >
                    {selectedPayee}
                  </DrilldownFireflyLink>
                </>
              )}
            </span>
          </CardTitle>
          {fireflyBaseUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openFireflySearch(fireflyBaseUrl, scopeFireflySearch)}
            >
              Search in Firefly
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <TransactionTable
            rows={pageRows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            isLoading={false}
            showAllTypes
            fireflyBaseUrl={fireflyBaseUrl}
          />
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {pageIndex + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border px-2 py-1 disabled:opacity-50"
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex((p) => p - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1 disabled:opacity-50"
                  disabled={pageIndex >= totalPages - 1}
                  onClick={() => setPageIndex((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
