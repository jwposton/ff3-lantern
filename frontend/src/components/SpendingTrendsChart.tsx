import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { TrendChartType } from "@/lib/trendsChartType"
import { formatCurrency } from "@/lib/spending"

export type TrendLineSeries = {
  name: string
  data: number[]
  dashed?: boolean
}

type SpendingTrendsChartProps = {
  months: string[]
  series: TrendLineSeries[]
  chartType: TrendChartType
  loading: boolean
  emptyMessage: string
}

const CHART_COLORS = [
  "#6EE7B7",
  "#60A5FA",
  "#F472B6",
  "#FBBF24",
  "#34D399",
  "#818CF8",
  "#F87171",
  "#C084FC",
  "#FCD34D",
  "#4ADE80",
  "#A78BFA",
  "#FCA5A5",
  "#FDE68A",
  "#7DD3FC",
  "#E879F9",
]

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

function axisTooltipFormatter(params: unknown): string {
  const items = Array.isArray(params) ? params : params ? [params] : []
  if (items.length === 0) return ""
  const first = items[0]
  if (!first || typeof first !== "object") return ""
  const period = String((first as { name?: string }).name ?? "")
  const lines = items
    .filter((item): item is object => item != null && typeof item === "object")
    .map((item) => {
      const record = item as { seriesName?: string; value?: unknown }
      return `${record.seriesName}: ${formatCurrency(tooltipValue(record.value))}`
    })
  return `${period}\n${lines.join("\n")}`
}

export function SpendingTrendsChart({
  months,
  series,
  chartType,
  loading,
  emptyMessage,
}: SpendingTrendsChartProps) {
  const isEmpty = !loading && (!hasNonZeroData(series) || months.length === 0)

  const option = useMemo((): EChartsOption => {
    const plotSeries = series.filter((s) => !s.dashed)

    if (chartType === "stacked-bar") {
      const monthlyTotals = months.map((_, monthIdx) =>
        plotSeries.reduce((sum, s) => sum + (s.data[monthIdx] ?? 0), 0),
      )

      const echartsSeries = plotSeries.map((item, idx) => {
        const isTopStack = idx === plotSeries.length - 1 && plotSeries.length > 1
        return {
          name: item.name,
          type: "bar" as const,
          stack: plotSeries.length > 1 ? "total" : undefined,
          barMaxWidth: 38,
          data: item.data,
          itemStyle: {
            color: CHART_COLORS[idx % CHART_COLORS.length],
          },
          emphasis: { focus: "series" as const },
          ...(isTopStack
            ? {
                label: {
                  show: true,
                  position: "top" as const,
                  fontSize: 12,
                  color: "hsl(240 5% 65%)",
                  formatter: (params: { dataIndex: number }) =>
                    formatCurrency(monthlyTotals[params.dataIndex] ?? 0),
                  offset: [0, -4],
                },
              }
            : {}),
        }
      })

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
          data: plotSeries.map((s) => s.name),
        },
        grid: { left: 48, right: 120, bottom: 40, top: 24 },
        xAxis: {
          type: "category",
          data: months,
          axisLabel: { rotate: 30 },
        },
        yAxis: {
          type: "value",
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
    }

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
        trigger: "axis",
        axisPointer: { type: "line" },
        formatter: axisTooltipFormatter,
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 0,
        top: "middle",
        data: series.map((s) => s.name),
      },
      grid: { left: 48, right: 120, bottom: 40, top: 24 },
      xAxis: {
        type: "category",
        data: months,
        axisLabel: { rotate: 30 },
      },
      yAxis: {
        type: "value",
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
  }, [months, series, chartType])

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
        <CardTitle className="text-base">Cash outflow over time</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-[380px] items-center justify-center text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <ReactECharts
            option={option}
            style={{ height: 380, width: "100%" }}
            notMerge
            lazyUpdate
          />
        )}
      </CardContent>
    </Card>
  )
}
