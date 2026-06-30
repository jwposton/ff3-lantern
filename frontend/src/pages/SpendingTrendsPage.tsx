import { useMemo, useState } from "react"

import { SpendingTrendsChart } from "@/components/SpendingTrendsChart"
import type { TrendLineSeries } from "@/components/SpendingTrendsChart"
import { TrendsControls } from "@/components/TrendsControls"
import { Button } from "@/components/ui/button"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import { buildTrendSeries } from "@/lib/trends"
import {
  readTrendChartType,
  writeTrendChartType,
  type TrendChartType,
} from "@/lib/trendsChartType"
import {
  readTrendViewMode,
  writeTrendViewMode,
  type TrendViewMode,
} from "@/lib/trendsViewMode"

export function SpendingTrendsPage() {
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(committedStart, committedEnd)

  const [viewMode, setViewMode] = useState<TrendViewMode>(readTrendViewMode)
  const [chartType, setChartType] = useState<TrendChartType>(readTrendChartType)
  const [topN, setTopN] = useState(8)

  const allRows = isSuccess ? (data?.data ?? []) : []

  const trendResult = useMemo(
    () =>
      buildTrendSeries({
        rows: allRows,
        start: committedStart,
        end: committedEnd,
        mode: viewMode,
        topN,
      }),
    [allRows, committedStart, committedEnd, viewMode, topN],
  )

  const chartSeries = useMemo((): TrendLineSeries[] => {
    const { series, totalOverlay } = trendResult
    if (chartType === "stacked-bar") {
      return series
    }
    if (viewMode === "category" && totalOverlay != null) {
      return [...series, { ...totalOverlay, dashed: true }]
    }
    return series
  }, [trendResult, viewMode, chartType])

  const controlsDisabled = isPending || isError

  function handleChartTypeChange(type: TrendChartType) {
    setChartType(type)
    writeTrendChartType(type)
  }

  function handleViewModeChange(mode: TrendViewMode) {
    setViewMode(mode)
    writeTrendViewMode(mode)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Cash Flow</h1>

      <TrendsControls
        viewMode={viewMode}
        chartType={chartType}
        topN={topN}
        onViewModeChange={handleViewModeChange}
        onChartTypeChange={handleChartTypeChange}
        onTopNChange={setTopN}
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
      ) : (
        <SpendingTrendsChart
          months={trendResult.months}
          series={chartSeries}
          chartType={chartType}
          loading={isPending}
          emptyMessage="No cash outflow in this date range"
        />
      )}
    </div>
  )
}
