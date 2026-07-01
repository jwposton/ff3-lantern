import { useCallback, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent } from "@/components/ui/card"
import { DashboardTileHeader } from "@/components/DashboardTileHeader"
import { Skeleton } from "@/components/ui/skeleton"
import { CHART_COLORS } from "@/lib/chartColors"
import { truncateLegendLabel } from "@/lib/chartLegend"
import { formatCurrency } from "@/lib/spending"

export type BudgetSpendSlice = {
  name: string
  value: number
}

/** Segments below this share hide exterior labels (tooltip still shows detail). */
export const PIE_LABEL_MIN_PERCENT = 5

const PIE_LEGEND_COLUMN_WIDTH = 108
const CHART_HEIGHT = 480
const CHART_OPTS = { renderer: "canvas" as const }

type BudgetSpendPieChartProps = {
  slices: BudgetSpendSlice[]
  loading: boolean
  emptyMessage: string
  chartTitle?: string
  chartSubtitle?: string
  chartTestId?: string
  onSliceSelect?: (name: string) => void
}

function tooltipFormatter(params: unknown): string {
  const item = Array.isArray(params) ? params[0] : params
  if (!item || typeof item !== "object") return ""
  const record = item as {
    name?: string
    value?: unknown
    percent?: number
  }
  const value =
    typeof record.value === "number" ? record.value : Number(record.value)
  const pct =
    typeof record.percent === "number" ? record.percent.toFixed(1) : "0.0"
  return `${record.name ?? ""}\n${formatCurrency(value)} (${pct}%)`
}

export function slicePercentMap(
  slices: readonly BudgetSpendSlice[],
): Map<string, number> {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const map = new Map<string, number>()
  for (const slice of slices) {
    map.set(slice.name, total > 0 ? (slice.value / total) * 100 : 0)
  }
  return map
}

export function pieSegmentLabel(
  name: string,
  percent: number,
  minPercent = PIE_LABEL_MIN_PERCENT,
): string {
  if (percent < minPercent) return ""
  const shortName = name.length > 18 ? `${name.slice(0, 16)}…` : name
  return `${shortName}\n${percent.toFixed(1)}%`
}

export function pieLegendLabel(name: string, percent: number): string {
  return `${truncateLegendLabel(name, 16)}  ${percent.toFixed(1)}%`
}

export function BudgetSpendPieChart({
  slices,
  loading,
  emptyMessage,
  chartTitle = "Spending by budget",
  chartSubtitle,
  chartTestId = "budget-spend-pie-chart",
  onSliceSelect,
}: BudgetSpendPieChartProps) {
  const isEmpty = !loading && slices.length === 0
  const percentByName = useMemo(() => slicePercentMap(slices), [slices])

  const option = useMemo((): EChartsOption => {
    return {
      tooltip: {
        trigger: "item",
        formatter: tooltipFormatter,
      },
      legend: {
        type: "plain",
        orient: "vertical",
        right: 4,
        top: "middle",
        width: PIE_LEGEND_COLUMN_WIDTH,
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 6,
        textStyle: { fontSize: 11, color: "hsl(240 5% 34%)" },
        data: slices.map((slice) => slice.name),
        formatter: (name: string) =>
          pieLegendLabel(name, percentByName.get(name) ?? 0),
      },
      series: [
        {
          type: "pie",
          radius: "68%",
          center: ["38%", "52%"],
          minAngle: 2,
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: "hsl(var(--background))",
            borderWidth: 1,
          },
          label: {
            show: true,
            fontSize: 11,
            color: "hsl(240 5% 34%)",
            lineHeight: 14,
            formatter: (params: { name?: string; percent?: number }) =>
              pieSegmentLabel(params.name ?? "", params.percent ?? 0),
          },
          labelLine: {
            length: 12,
            length2: 10,
            smooth: true,
            lineStyle: { color: "hsl(240 5% 65%)" },
          },
          labelLayout: {
            hideOverlap: true,
          },
          emphasis: {
            scale: true,
            scaleSize: 6,
            itemStyle: {
              shadowBlur: 8,
              shadowColor: "rgba(0, 0, 0, 0.12)",
            },
          },
          data: slices.map((slice, idx) => ({
            name: slice.name,
            value: slice.value,
            itemStyle: { color: CHART_COLORS[idx % CHART_COLORS.length] },
          })),
        },
      ],
    }
  }, [slices, percentByName])

  const handleChartClick = useCallback(
    (params: { name?: string }) => {
      if (params.name && onSliceSelect) {
        onSliceSelect(params.name)
      }
    },
    [onSliceSelect],
  )

  const onEvents = useMemo(() => {
    if (!onSliceSelect) return undefined
    return { click: handleChartClick }
  }, [handleChartClick, onSliceSelect])

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
          <div className="flex h-[480px] items-center justify-center text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <ReactECharts
            option={option}
            opts={CHART_OPTS}
            style={{
              height: CHART_HEIGHT,
              width: "100%",
              cursor: onSliceSelect ? "pointer" : undefined,
            }}
            onEvents={onEvents}
            notMerge
            lazyUpdate
            data-testid={chartTestId}
          />
        )}
      </CardContent>
    </Card>
  )
}
