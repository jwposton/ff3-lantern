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

function itemTooltipFormatter(params: unknown): string {
  const item = Array.isArray(params) ? params[0] : params
  if (!item || typeof item !== "object") return ""
  const record = item as {
    seriesName?: string
    name?: string
    value?: number
  }
  const period = String(record.name ?? "")
  const value =
    typeof record.value === "number" ? record.value : Number(record.value)
  return `${period}\n${record.seriesName}: ${formatCurrency(value)}`
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
      showSymbol: false,
      triggerLineEvent: true,
      data: item.data,
      lineStyle: {
        width: 2,
        type: item.dashed ? ("dashed" as const) : ("solid" as const),
      },
      itemStyle: {
        color: CHART_COLORS[idx % CHART_COLORS.length],
      },
      emphasis: { focus: "series" as const },
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
