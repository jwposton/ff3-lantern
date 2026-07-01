import { useCallback, useMemo, useRef } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CHART_COLORS } from "@/lib/chartColors"
import {
  chartGridWithVerticalLegend,
  verticalRightLegend,
} from "@/lib/chartLegend"
import { formatCurrency } from "@/lib/spending"

export type MomTrendSeries = {
  name: string
  data: number[]
}

type MomTrendChartProps = {
  deltaMonths: string[]
  series: MomTrendSeries[]
  loading: boolean
  emptyMessage: string
  chartTitle: string
  interactionHint?: string
  yAxisName: string
  onSelect?: (budget: string) => void
  /** When true, render chart body only (no Card shell) for drilldown embedding. */
  embedded?: boolean
}

function hasData(series: MomTrendSeries[]): boolean {
  return series.length > 0 && series.some((s) => s.data.length > 0)
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
  const month = String(record.name ?? "")
  return `${month}\n${record.seriesName}: ${formatCurrency(tooltipValue(record.value))}`
}

export function MomTrendChart({
  deltaMonths,
  series,
  loading,
  emptyMessage,
  chartTitle,
  interactionHint,
  yAxisName,
  onSelect,
  embedded = false,
}: MomTrendChartProps) {
  const isEmpty = !loading && (!hasData(series) || deltaMonths.length === 0)
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
      lineStyle: { width: 2 },
      itemStyle: {
        color: CHART_COLORS[idx % CHART_COLORS.length],
      },
      emphasis: {
        focus: "series" as const,
        scale: true,
        itemStyle: { borderWidth: 2 },
      },
      markLine:
        idx === 0
          ? {
              silent: true,
              symbol: "none" as const,
              lineStyle: {
                type: "dashed" as const,
                color: "hsla(240, 4%, 46%, 0.4)",
              },
              data: [{ yAxis: 0 }],
            }
          : undefined,
    }))

    const legendLabels = series.map((s) => s.name)

    return {
      tooltip: {
        trigger: "item",
        formatter: itemTooltipFormatter,
      },
      legend: {
        ...verticalRightLegend(legendLabels),
        triggerEvent: onSelect != null,
      },
      grid: chartGridWithVerticalLegend(legendLabels),
      xAxis: {
        type: "category",
        data: deltaMonths,
        axisLabel: { rotate: 30 },
      },
      yAxis: {
        type: "value",
        name: yAxisName,
        axisLabel: {
          formatter: (value: number) => formatCurrency(value),
        },
        splitLine: {
          lineStyle: { type: "dashed", color: "hsl(240 5% 90%)" },
        },
      },
      series: echartsSeries,
    }
  }, [deltaMonths, series, yAxisName, onSelect])

  const handleChartClick = useCallback(
    (params: { seriesName?: string }) => {
      if (params?.seriesName && onSelect) {
        onSelect(params.seriesName)
      }
    },
    [onSelect],
  )

  const handleLegendSelectChanged = useCallback(
    (params: { name?: string; selected?: Record<string, boolean> }) => {
      if (!params.name || !onSelect) return
      onSelect(params.name)
      const chart = chartRef.current?.getEchartsInstance()
      if (chart && params.selected) {
        chart.dispatchAction({ type: "legendAllSelect" })
      }
    },
    [onSelect],
  )

  const onEvents = useMemo(() => {
    if (!onSelect) return undefined
    return {
      click: handleChartClick,
      legendselectchanged: handleLegendSelectChanged,
    }
  }, [handleChartClick, handleLegendSelectChanged, onSelect])

  const chartBody = isEmpty ? (
    <div className="flex min-h-[480px] items-center justify-center text-center text-sm text-muted-foreground">
      {emptyMessage}
    </div>
  ) : (
    <ReactECharts
      ref={chartRef}
      option={option}
      style={{ height: 480, width: "100%" }}
      onEvents={onEvents}
      notMerge
      lazyUpdate
      data-testid={embedded ? "mom-trend-chart-embedded" : "mom-trend-chart"}
    />
  )

  if (loading) {
    if (embedded) {
      return <Skeleton className="h-[480px] w-full" />
    }
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[480px] w-full" />
        </CardContent>
      </Card>
    )
  }

  if (embedded) {
    return chartBody
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{chartTitle}</CardTitle>
        {interactionHint ? (
          <p className="text-sm text-muted-foreground">{interactionHint}</p>
        ) : null}
      </CardHeader>
      <CardContent>{chartBody}</CardContent>
    </Card>
  )
}
