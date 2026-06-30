import { useEffect, useMemo, useState } from "react"

import { BudgetReportDrilldown } from "@/components/BudgetReportDrilldown"
import { SpendingBarChart } from "@/components/SpendingBarChart"
import { Button } from "@/components/ui/button"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import { buildBarChartData } from "@/lib/barChart"
import type { OmniRow } from "@/types/NormalizedTransaction"

export type BudgetBarReportPageProps = {
  filter: (row: OmniRow) => boolean
  pageTitle: string
  mainChartTitle: string
  emptyMessage: string
  yAxisName: string
  useCashFlowLabels?: boolean
}

export function BudgetBarReportPage({
  filter,
  pageTitle,
  mainChartTitle,
  emptyMessage,
  yAxisName,
  useCashFlowLabels = false,
}: BudgetBarReportPageProps) {
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(committedStart, committedEnd)

  const [selectedBudget, setSelectedBudget] = useState<string | null>(null)

  useEffect(() => {
    setSelectedBudget(null)
  }, [committedStart, committedEnd])

  const allRows = isSuccess ? (data?.data ?? []) : []

  const sliceRows = useMemo(() => allRows.filter(filter), [allRows, filter])

  const budgetChartData = useMemo(
    () =>
      buildBarChartData(sliceRows, ["month", "budget"], {
        start: committedStart,
        end: committedEnd,
        useCashFlowLabels,
      }),
    [sliceRows, committedStart, committedEnd, useCashFlowLabels],
  )

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">{pageTitle}</h1>

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
            emptyMessage={emptyMessage}
            onSelect={setSelectedBudget}
            chartTitle={mainChartTitle}
            yAxisName={yAxisName}
          />
          {selectedBudget != null && (
            <BudgetReportDrilldown
              rows={sliceRows}
              budget={selectedBudget}
              start={committedStart}
              end={committedEnd}
              chartType="bar"
              useCashFlowLabels={useCashFlowLabels}
              yAxisName={yAxisName}
              fireflyBaseUrl={data?.firefly_base_url}
              onClearBudget={() => setSelectedBudget(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
