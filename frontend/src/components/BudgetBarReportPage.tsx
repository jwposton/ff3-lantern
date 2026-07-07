import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { BudgetReportDrilldown } from "@/components/BudgetReportDrilldown"
import { ReportPageHeader } from "@/components/ReportPageHeader"
import { SpendingBarChart } from "@/components/SpendingBarChart"
import { SpendingBarViewControls } from "@/components/SpendingBarViewControls"
import { Button } from "@/components/ui/button"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import {
  buildBarChartData,
  buildMonthlyIncomeTotals,
  buildSplitBarChartData,
} from "@/lib/barChart"
import type { PaymentRail } from "@/lib/spendingRail"
import {
  parseSpendingBarViewMode,
  spendingBarViewSearchParam,
  type SpendingBarViewMode,
} from "@/lib/spendingBarView"
import type { OmniRow } from "@/types/NormalizedTransaction"

export type BudgetBarReportPageProps = {
  filter: (row: OmniRow) => boolean
  pageTitle: string
  mainChartTitle: string
  emptyMessage: string
  yAxisName: string
  useCashFlowLabels?: boolean
  /** Enables Combined vs Cash & Credit view on the spending bar chart. */
  enablePaymentRailSplit?: boolean
}

export function BudgetBarReportPage({
  filter,
  pageTitle,
  mainChartTitle,
  emptyMessage,
  yAxisName,
  useCashFlowLabels = false,
  enablePaymentRailSplit = false,
}: BudgetBarReportPageProps) {
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const [searchParams, setSearchParams] = useSearchParams()
  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(committedStart, committedEnd)

  const [selectedBudget, setSelectedBudget] = useState<string | null>(null)
  const [selectedPaymentRail, setSelectedPaymentRail] =
    useState<PaymentRail | null>(null)
  const [viewMode, setViewMode] = useState<SpendingBarViewMode>("combined")
  const prevRangeRef = useRef({ start: committedStart, end: committedEnd })

  useEffect(() => {
    setSelectedBudget(searchParams.get("budget"))
    const parsedView = enablePaymentRailSplit
      ? parseSpendingBarViewMode(searchParams.get("view"))
      : "combined"
    if (enablePaymentRailSplit) {
      setViewMode(parsedView)
    }
    const rail = searchParams.get("rail")
    setSelectedPaymentRail(
      parsedView === "split" && (rail === "cash" || rail === "credit")
        ? rail
        : null,
    )
  }, [searchParams, enablePaymentRailSplit])

  useEffect(() => {
    const prev = prevRangeRef.current
    if (prev.start === committedStart && prev.end === committedEnd) return
    prevRangeRef.current = { start: committedStart, end: committedEnd }

    setSelectedBudget(null)
    setSelectedPaymentRail(null)
    const next = new URLSearchParams(searchParams)
    let changed = false
    if (next.has("budget")) {
      next.delete("budget")
      changed = true
    }
    if (next.has("rail")) {
      next.delete("rail")
      changed = true
    }
    if (changed) {
      setSearchParams(next, { replace: true })
    }
  }, [committedStart, committedEnd, searchParams, setSearchParams])

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

  const splitChartData = useMemo(
    () =>
      buildSplitBarChartData(sliceRows, {
        start: committedStart,
        end: committedEnd,
        useCashFlowLabels,
      }),
    [sliceRows, committedStart, committedEnd, useCashFlowLabels],
  )

  const monthlyIncome = useMemo(
    () => buildMonthlyIncomeTotals(allRows, committedStart, committedEnd),
    [allRows, committedStart, committedEnd],
  )

  function syncDrillToUrl(budget: string | null, rail: PaymentRail | null) {
    const next = new URLSearchParams(searchParams)
    if (budget != null) {
      next.set("budget", budget)
    } else {
      next.delete("budget")
    }
    if (rail != null) {
      next.set("rail", rail)
    } else {
      next.delete("rail")
    }
    setSearchParams(next, { replace: true })
  }

  function handleBudgetSelect(budget: string, paymentRail?: PaymentRail) {
    setSelectedBudget(budget)
    setSelectedPaymentRail(paymentRail ?? null)
    syncDrillToUrl(budget, paymentRail ?? null)
  }

  function handleClearBudget() {
    setSelectedBudget(null)
    setSelectedPaymentRail(null)
    syncDrillToUrl(null, null)
  }

  function handleViewModeChange(mode: SpendingBarViewMode) {
    setViewMode(mode)
    if (mode === "combined") {
      setSelectedPaymentRail(null)
    }
    const next = new URLSearchParams(searchParams)
    const viewParam = spendingBarViewSearchParam(mode)
    if (viewParam != null) {
      next.set("view", viewParam)
    } else {
      next.delete("view")
    }
    if (mode === "combined") {
      next.delete("rail")
    }
    setSearchParams(next, { replace: true })
  }

  const activeViewMode = enablePaymentRailSplit ? viewMode : "combined"

  return (
    <div className="space-y-8">
      <ReportPageHeader title={pageTitle} />

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
            viewMode={activeViewMode}
            chartData={budgetChartData}
            splitChartData={splitChartData}
            loading={isPending}
            emptyMessage={emptyMessage}
            onSelect={handleBudgetSelect}
            chartTitle={mainChartTitle}
            yAxisName={yAxisName}
            monthlyIncome={monthlyIncome}
            headerControls={
              enablePaymentRailSplit ? (
                <SpendingBarViewControls
                  viewMode={activeViewMode}
                  onViewModeChange={handleViewModeChange}
                  disabled={isPending}
                />
              ) : undefined
            }
          />
          {selectedBudget != null && (
            <BudgetReportDrilldown
              rows={sliceRows}
              budget={selectedBudget}
              paymentRail={selectedPaymentRail ?? undefined}
              start={committedStart}
              end={committedEnd}
              chartType="bar"
              useCashFlowLabels={useCashFlowLabels}
              yAxisName={yAxisName}
              fireflyBaseUrl={data?.firefly_base_url}
              onClearBudget={handleClearBudget}
            />
          )}
        </div>
      )}
    </div>
  )
}
