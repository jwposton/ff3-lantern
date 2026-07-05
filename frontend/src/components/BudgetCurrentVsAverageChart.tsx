import { useCallback, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent } from "@/components/ui/card"
import { DashboardTileHeader } from "@/components/DashboardTileHeader"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { compareChartHeight } from "@/components/MomCompareChart"
import {
  budgetVsAverageDisplayHint,
  buildPercentBarChartData,
  percentOfAverageLabel,
  type PercentBarChartDatum,
} from "@/lib/budgetVsAverageTile"
import type {
  BudgetVsAverageDisplayMode,
  BudgetVsAverageRankMode,
} from "@/lib/budgetVsAveragePrefs"
import type { CurrentVsBaseline } from "@/lib/momVariance"
import { categoryAxisRowStripes } from "@/lib/chartStripes"
import { formatCurrency } from "@/lib/spending"

const CURRENT_COLOR = "#60A5FA"
const AVERAGE_COLOR = "#94A3B8"
const PERCENT_COLOR = "#60A5FA"
const NO_PRIOR_AVERAGE_COLOR = "#F59E0B"
const CHART_OPTS = { renderer: "canvas" as const }

type BudgetCurrentVsAverageChartProps = {
  sortedNames: string[]
  values: Map<string, CurrentVsBaseline>
  loading: boolean
  emptyMessage: string
  chartTitle?: string
  chartSubtitle?: string
  currentSeriesLabel?: string
  averageSeriesLabel?: string
  yAxisName?: string
  rankMode?: BudgetVsAverageRankMode
  displayMode?: BudgetVsAverageDisplayMode
  onRankModeChange?: (mode: BudgetVsAverageRankMode) => void
  onDisplayModeChange?: (mode: BudgetVsAverageDisplayMode) => void
  controlsDisabled?: boolean
  onSelect?: (name: string) => void
}

function tooltipValue(value: unknown): number {
  if (typeof value === "number") return value
  if (Array.isArray(value)) {
    const last = value[value.length - 1]
    return typeof last === "number" ? last : Number(last)
  }
  return Number(value)
}

function dollarsTooltipFormatter(params: unknown): string {
  const item = Array.isArray(params) ? params[0] : params
  if (!item || typeof item !== "object") return ""
  const record = item as {
    seriesName?: string
    name?: string
    value?: unknown
  }
  return `${record.name ?? ""}\n${record.seriesName}: ${formatCurrency(tooltipValue(record.value))}`
}

function percentTooltipFormatter(
  values: Map<string, CurrentVsBaseline>,
): (params: unknown) => string {
  return (params: unknown) => {
    const item = Array.isArray(params) ? params[0] : params
    if (!item || typeof item !== "object") return ""
    const record = item as { name?: string; value?: unknown }
    const name = record.name ?? ""
    const pair = values.get(name)
    if (!pair) return name

    const pctLabel = percentOfAverageLabel(pair.current, pair.baseline)
    const lines = [
      name,
      pctLabel,
      `Current: ${formatCurrency(pair.current)}`,
      `12-mo avg: ${formatCurrency(pair.baseline)}`,
    ]
    if (pair.baseline === 0 && pair.current > 0) {
      lines.push("Amber bar is not a % ratio — no prior average to compare")
    }
    return lines.join("\n")
  }
}

function percentBarEChartsDatum(datum: PercentBarChartDatum) {
  if (datum.kind === "empty") return null
  if (datum.kind === "ratio") {
    return { value: datum.percent, itemStyle: { color: PERCENT_COLOR } }
  }
  return {
    value: datum.barPercent,
    itemStyle: { color: NO_PRIOR_AVERAGE_COLOR },
    label: {
      show: true,
      position: "right" as const,
      formatter: formatCurrency(datum.current),
      fontSize: 11,
      color: "hsl(240 5% 34%)",
    },
  }
}

export function BudgetCurrentVsAverageChart({
  sortedNames,
  values,
  loading,
  emptyMessage,
  chartTitle = "Current month vs 12-month average",
  chartSubtitle,
  currentSeriesLabel = "Current month",
  averageSeriesLabel = "12-mo average",
  yAxisName = "Spending",
  rankMode = "change-vs-average",
  displayMode = "dollars",
  onRankModeChange,
  onDisplayModeChange,
  controlsDisabled = false,
  onSelect,
}: BudgetCurrentVsAverageChartProps) {
  const isEmpty = !loading && sortedNames.length === 0
  const chartHeight = compareChartHeight(sortedNames.length)
  const showControls = onRankModeChange != null && onDisplayModeChange != null
  const isPercentMode = displayMode === "percent-of-average"

  const option = useMemo((): EChartsOption => {
    if (isPercentMode) {
      const percentData = buildPercentBarChartData(sortedNames, values)
      const seriesData = percentData.map(percentBarEChartsDatum)
      const barValues = seriesData
        .map((datum) => datum?.value)
        .filter((value): value is number => typeof value === "number")
      const xMax = Math.max(150, ...barValues, 100) + 10

      return {
        tooltip: {
          trigger: "item",
          formatter: percentTooltipFormatter(values),
        },
        legend: {
          top: 0,
          itemWidth: 14,
          itemHeight: 10,
          textStyle: { fontSize: 12, color: "hsl(240 5% 34%)" },
          data: [
            { name: "% of 12-mo average", itemStyle: { color: PERCENT_COLOR } },
            {
              name: "New spending (no avg)",
              itemStyle: { color: NO_PRIOR_AVERAGE_COLOR },
            },
          ],
        },
        grid: { left: 110, right: 56, top: 40, bottom: 30 },
        xAxis: {
          type: "value",
          name: "% of average",
          min: 0,
          max: xMax,
          axisLabel: {
            formatter: (value: number) => `${value}%`,
          },
          splitLine: {
            lineStyle: { type: "dashed", color: "hsl(240 5% 90%)" },
          },
        },
        yAxis: {
          type: "category",
          data: sortedNames,
          inverse: true,
          ...categoryAxisRowStripes(),
        },
        series: [
          {
            name: "% of 12-mo average",
            type: "bar",
            barCategoryGap: "36%",
            data: seriesData,
            markLine: {
              silent: true,
              symbol: "none",
              lineStyle: { type: "dashed", color: "hsl(240 5% 64%)" },
              data: [{ xAxis: 100 }],
              label: { formatter: "100%", fontSize: 11 },
            },
          },
        ],
      }
    }

    return {
      tooltip: {
        trigger: "item",
        formatter: dollarsTooltipFormatter,
      },
      legend: {
        top: 0,
        itemWidth: 14,
        itemHeight: 10,
        textStyle: { fontSize: 12, color: "hsl(240 5% 34%)" },
        data: [currentSeriesLabel, averageSeriesLabel],
      },
      grid: { left: 110, right: 24, top: 40, bottom: 30 },
      xAxis: {
        type: "value",
        name: yAxisName,
        min: 0,
        axisLabel: {
          formatter: (value: number) => formatCurrency(value),
        },
        splitLine: {
          lineStyle: { type: "dashed", color: "hsl(240 5% 90%)" },
        },
      },
      yAxis: {
        type: "category",
        data: sortedNames,
        inverse: true,
        ...categoryAxisRowStripes(),
      },
      series: [
        {
          name: currentSeriesLabel,
          type: "bar",
          barGap: "20%",
          barCategoryGap: "36%",
          data: sortedNames.map((name) => values.get(name)?.current ?? 0),
          itemStyle: { color: CURRENT_COLOR },
        },
        {
          name: averageSeriesLabel,
          type: "bar",
          data: sortedNames.map((name) => values.get(name)?.baseline ?? 0),
          itemStyle: { color: AVERAGE_COLOR },
        },
      ],
    }
  }, [
    sortedNames,
    values,
    currentSeriesLabel,
    averageSeriesLabel,
    yAxisName,
    isPercentMode,
  ])

  const handleChartClick = useCallback(
    (params: { name?: string; seriesName?: string }) => {
      const name = params.name ?? params.seriesName
      if (name && onSelect) {
        onSelect(name)
      }
    },
    [onSelect],
  )

  const onEvents = useMemo(() => {
    if (!onSelect) return undefined
    return { click: handleChartClick }
  }, [handleChartClick, onSelect])

  const controls = showControls ? (
    <div
      className={`flex flex-wrap items-center gap-3 px-6 pb-2 text-sm ${controlsDisabled ? "opacity-50" : ""}`}
    >
      <div
        className="inline-flex rounded-md border shadow-xs"
        role="group"
        aria-label="Rank budgets by"
      >
        <Button
          type="button"
          variant={rankMode === "total-spend" ? "default" : "outline"}
          size="sm"
          className="rounded-r-none border-0"
          disabled={controlsDisabled}
          onClick={() => onRankModeChange!("total-spend")}
        >
          Total spend
        </Button>
        <Button
          type="button"
          variant={rankMode === "change-vs-average" ? "default" : "outline"}
          size="sm"
          className="rounded-l-none border-0 border-l"
          disabled={controlsDisabled}
          onClick={() => onRankModeChange!("change-vs-average")}
        >
          Change vs avg
        </Button>
      </div>

      <div
        className="inline-flex rounded-md border shadow-xs"
        role="group"
        aria-label="Display bars as"
      >
        <Button
          type="button"
          variant={displayMode === "dollars" ? "default" : "outline"}
          size="sm"
          className="rounded-r-none border-0"
          disabled={controlsDisabled}
          onClick={() => onDisplayModeChange!("dollars")}
        >
          Dollars
        </Button>
        <Button
          type="button"
          variant={displayMode === "percent-of-average" ? "default" : "outline"}
          size="sm"
          className="rounded-l-none border-0 border-l"
          disabled={controlsDisabled}
          onClick={() => onDisplayModeChange!("percent-of-average")}
        >
          % of average
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {budgetVsAverageDisplayHint(displayMode)}
      </p>
    </div>
  ) : null

  if (loading) {
    return (
      <Card>
        <DashboardTileHeader title={chartTitle} subtitle={chartSubtitle} />
        {controls}
        <CardContent>
          <Skeleton className="h-[480px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <DashboardTileHeader title={chartTitle} subtitle={chartSubtitle} />
      {controls}
      <CardContent>
        {isEmpty ? (
          <div
            className="flex items-center justify-center text-center text-sm text-muted-foreground"
            style={{ minHeight: 480 }}
          >
            {emptyMessage}
          </div>
        ) : (
          <ReactECharts
            option={option}
            opts={CHART_OPTS}
            style={{
              height: chartHeight,
              width: "100%",
              cursor: onSelect ? "pointer" : undefined,
            }}
            onEvents={onEvents}
            notMerge
            lazyUpdate
            data-testid="budget-current-vs-average-chart"
          />
        )}
      </CardContent>
    </Card>
  )
}
