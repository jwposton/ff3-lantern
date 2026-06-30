import { useCallback, useMemo, useRef } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { TrendLineSeries } from "@/lib/barChart"
import { TOTAL_LABEL } from "@/lib/barChart"
import { CHART_COLORS } from "@/lib/chartColors"
import { formatCurrency } from "@/lib/spending"

type BudgetLineChartProps = {
  months: string[]
  series: TrendLineSeries[]
  loading: boolean
  emptyMessage: string
  chartTitle: string
  yAxisName: string
  onSelect: (budget: string) => void
}

function hasNonZeroData(series: TrendLineSeries[]): boolean {
  return series.some((s) => s.data.some((v) => v > 0))
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
  const period = String(record.name ?? "")
  return `${period}\n${record.seriesName}: ${formatCurrency(tooltipValue(record.value))}`
}

export function BudgetLineChart({
  months,
  series,
  loading,
  emptyMessage,
  chartTitle,
  yAxisName,
  onSelect,
}: BudgetLineChartProps) {
  const isEmpty = !loading && (!hasNonZeroData(series) || months.length === 0)
  const chartRef = useRef<ReactECharts>(null)

  const option = useMemo((): EChartsOption => {
    const echartsSeries = series.map((item, idx) => ({
      name: item.name,
      type: "line" as const,
      smooth: false,
      showSymbol: true,
      symbolSize: 6,
      triggerLineEvent: true,
      data: item.data,
      lineStyle: {
        width: 2,
        type: item.dashed ? ("dashed" as const) : ("solid" as const),
      },
      itemStyle: {
        color: CHART_COLORS[idx % CHART_COLORS.length],
      },
      emphasis: {
        focus: "series" as const,
        scale: true,
        itemStyle: { borderWidth: 2 },
      },
    }))

    return {
      tooltip: {
        trigger: "item",
        formatter: itemTooltipFormatter,
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 0,
        top: "middle",
        data: series.map((s) => s.name),
        triggerEvent: true,
      },
      grid: { left: 48, right: 120, bottom: 40, top: 24 },
      xAxis: {
        type: "category",
        data: months,
        axisLabel: { rotate: 30 },
      },
      yAxis: {
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
      series: echartsSeries,
    }
  }, [months, series, yAxisName])

  const handleChartClick = useCallback(
    (params: { seriesName?: string }) => {
      if (params?.seriesName && params.seriesName !== TOTAL_LABEL) {
        onSelect(params.seriesName)
      }
    },
    [onSelect],
  )

  const handleLegendSelectChanged = useCallback(
    (params: { name?: string; selected?: Record<string, boolean> }) => {
      if (!params.name || params.name === TOTAL_LABEL) return
      onSelect(params.name)
      const chart = chartRef.current?.getEchartsInstance()
      if (chart && params.selected) {
        chart.dispatchAction({ type: "legendAllSelect" })
      }
    },
    [onSelect],
  )

  const onEvents = useMemo(
    () => ({
      click: handleChartClick,
      legendselectchanged: handleLegendSelectChanged,
    }),
    [handleChartClick, handleLegendSelectChanged],
  )

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[380px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{chartTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-[380px] items-center justify-center text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: 380, width: "100%" }}
            onEvents={onEvents}
            notMerge
            lazyUpdate
          />
        )}
      </CardContent>
    </Card>
  )
}
