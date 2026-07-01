import { useCallback, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent } from "@/components/ui/card"
import { DashboardTileHeader } from "@/components/DashboardTileHeader"
import { Skeleton } from "@/components/ui/skeleton"
import { compareChartHeight } from "@/components/MomCompareChart"
import type { CurrentVsBaseline } from "@/lib/momVariance"
import { categoryAxisRowStripes } from "@/lib/chartStripes"
import { formatCurrency } from "@/lib/spending"

const CURRENT_COLOR = "#60A5FA"
const AVERAGE_COLOR = "#94A3B8"
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

function itemTooltipFormatter(params: unknown): string {
  const item = Array.isArray(params) ? params[0] : params
  if (!item || typeof item !== "object") return ""
  const record = item as {
    seriesName?: string
    name?: string
    value?: unknown
  }
  return `${record.name ?? ""}\n${record.seriesName}: ${formatCurrency(tooltipValue(record.value))}`
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
  onSelect,
}: BudgetCurrentVsAverageChartProps) {
  const isEmpty = !loading && sortedNames.length === 0
  const chartHeight = compareChartHeight(sortedNames.length)

  const option = useMemo((): EChartsOption => {
    return {
      tooltip: {
        trigger: "item",
        formatter: itemTooltipFormatter,
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

  if (loading) {
    return (
      <Card>
        <DashboardTileHeader title={chartTitle} subtitle={chartSubtitle} />
        <CardContent>
          <Skeleton className="h-[480px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <DashboardTileHeader title={chartTitle} subtitle={chartSubtitle} />
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
