import { useCallback, useMemo, useRef } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/spending"

const DELTA_INCREASE_COLOR = "#ef4444"
const DELTA_DECREASE_COLOR = "#22c55e"

export function compareChartHeight(rowCount: number): number {
  return Math.min(720, Math.max(480, 480 + Math.max(0, rowCount - 12) * 28))
}

function formatSignedCurrency(value: number): string {
  const prefix = value >= 0 ? "+" : ""
  return `${prefix}${formatCurrency(value)}`
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
  const record = item as { name?: string; value?: unknown }
  const value = tooltipValue(record.value)
  return `${record.name ?? ""}\nΔ: ${formatSignedCurrency(value)}`
}

type MomCompareChartProps = {
  sortedNames: string[]
  deltas: Map<string, number>
  loading: boolean
  emptyMessage: string
  chartTitle: string
  interactionHint?: string
  yAxisName: string
  onSelect?: (name: string) => void
}

export function MomCompareChart({
  sortedNames,
  deltas,
  loading,
  emptyMessage,
  chartTitle,
  interactionHint,
  yAxisName,
  onSelect,
}: MomCompareChartProps) {
  const isEmpty = !loading && sortedNames.length === 0
  const chartHeight = compareChartHeight(sortedNames.length)
  const chartRef = useRef<ReactECharts>(null)

  const option = useMemo((): EChartsOption => {
    const barData = sortedNames.map((name) => {
      const delta = deltas.get(name) ?? 0
      return {
        value: delta,
        itemStyle: {
          color: delta >= 0 ? DELTA_INCREASE_COLOR : DELTA_DECREASE_COLOR,
        },
      }
    })

    return {
      tooltip: {
        trigger: "item",
        formatter: itemTooltipFormatter,
      },
      grid: { left: 110, right: 40, top: 24, bottom: 30 },
      xAxis: {
        type: "value",
        name: yAxisName,
        axisLabel: {
          formatter: (value: number) => formatCurrency(Math.abs(value)),
        },
        splitLine: {
          lineStyle: { type: "dashed", color: "hsl(240 5% 90%)" },
        },
      },
      yAxis: {
        type: "category",
        data: sortedNames,
        inverse: true,
      },
      series: [
        {
          type: "bar",
          data: barData,
          label: {
            show: true,
            position: "right",
            fontSize: 10,
            formatter: (params: { value?: unknown }) =>
              formatSignedCurrency(tooltipValue(params.value)),
          },
        },
      ],
    }
  }, [sortedNames, deltas, yAxisName])

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
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[480px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{chartTitle}</CardTitle>
        {interactionHint ? (
          <p className="text-sm text-muted-foreground">{interactionHint}</p>
        ) : null}
      </CardHeader>
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
            ref={chartRef}
            option={option}
            style={{ height: chartHeight, width: "100%" }}
            onEvents={onEvents}
            notMerge
            lazyUpdate
            data-testid="mom-compare-chart"
          />
        )}
      </CardContent>
    </Card>
  )
}
