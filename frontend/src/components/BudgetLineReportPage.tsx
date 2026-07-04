import { useEffect, useMemo, useState } from "react"

import { BudgetReportDrilldown } from "@/components/BudgetReportDrilldown"
import { BudgetLineChart } from "@/components/BudgetLineChart"
import { ReportPageHeader } from "@/components/ReportPageHeader"
import { Button } from "@/components/ui/button"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import {
  barChartDataToLineSeries,
  buildBarChartData,
} from "@/lib/barChart"
import {
  readBudgetLineShowTotal,
  writeBudgetLineShowTotal,
} from "@/lib/budgetLineShowTotal"
import type { OmniRow } from "@/types/NormalizedTransaction"

export type BudgetLineReportPageProps = {
  filter: (row: OmniRow) => boolean
  pageTitle: string
  lineChartTitle: string
  emptyMessage: string
  yAxisName: string
  useCashFlowLabels?: boolean
}

export function BudgetLineReportPage({
  filter,
  pageTitle,
  lineChartTitle,
  emptyMessage,
  yAxisName,
  useCashFlowLabels = false,
}: BudgetLineReportPageProps) {
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(committedStart, committedEnd)

  const [selectedBudget, setSelectedBudget] = useState<string | null>(null)
  const [showTotal, setShowTotal] = useState(readBudgetLineShowTotal)

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

  const lineSeries = useMemo(
    () =>
      barChartDataToLineSeries(budgetChartData, { includeTotal: showTotal }),
    [budgetChartData, showTotal],
  )

  function handleShowTotalChange(checked: boolean) {
    setShowTotal(checked)
    writeBudgetLineShowTotal(checked)
  }

  return (
    <div className="space-y-8">
      <ReportPageHeader title={pageTitle} />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showTotal}
          aria-label="Show total"
          className="size-4 accent-primary"
          onChange={(e) => handleShowTotalChange(e.target.checked)}
        />
        Show total
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
      ) : (
        <div className="space-y-8">
          <BudgetLineChart
            months={budgetChartData.months}
            series={lineSeries}
            loading={isPending}
            emptyMessage={emptyMessage}
            onSelect={setSelectedBudget}
            chartTitle={lineChartTitle}
            yAxisName={yAxisName}
          />
          {selectedBudget != null && (
            <BudgetReportDrilldown
              rows={sliceRows}
              budget={selectedBudget}
              start={committedStart}
              end={committedEnd}
              chartType="line"
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
