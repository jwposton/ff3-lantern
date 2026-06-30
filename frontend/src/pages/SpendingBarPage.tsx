import { useEffect, useMemo, useState } from "react"

import { BudgetDrilldownBarChart } from "@/components/BudgetDrilldownBarChart"
import { SpendingBarChart } from "@/components/SpendingBarChart"
import { Button } from "@/components/ui/button"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import { buildBarChartData } from "@/lib/barChart"
import { isSpendingExpense } from "@/lib/spending"

export function SpendingBarPage() {
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(committedStart, committedEnd)

  const [selectedBudget, setSelectedBudget] = useState<string | null>(null)

  useEffect(() => {
    setSelectedBudget(null)
  }, [committedStart, committedEnd])

  const allRows = isSuccess ? (data?.data ?? []) : []

  const spendingRows = useMemo(
    () => allRows.filter(isSpendingExpense),
    [allRows],
  )

  const budgetChartData = useMemo(
    () =>
      buildBarChartData(spendingRows, ["month", "budget"], {
        start: committedStart,
        end: committedEnd,
      }),
    [spendingRows, committedStart, committedEnd],
  )

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Spending</h1>

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
      ) : (
        <div className="space-y-8">
          <SpendingBarChart
            chartData={budgetChartData}
            loading={isPending}
            emptyMessage="No spending in this date range"
            onSelect={setSelectedBudget}
          />
          {selectedBudget != null && (
            <BudgetDrilldownBarChart
              rows={spendingRows}
              budget={selectedBudget}
              start={committedStart}
              end={committedEnd}
              onClear={() => setSelectedBudget(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
