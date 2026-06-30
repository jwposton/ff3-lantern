import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/spending"

export type TrendLineSeries = {
  name: string
  data: number[]
  dashed?: boolean
}

type SpendingTrendsChartProps = {
  months: string[]
  series: TrendLineSeries[]
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

export function SpendingTrendsChart({
  months,
  series,
  loading,
  emptyMessage,
}: SpendingTrendsChartProps) {
  const isEmpty = !loading && (!hasNonZeroData(series) || months.length === 0)

  const option = useMemo((): EChartsOption => {
    const echartsSeries = series.map((item, idx) => ({
      name: item.name,
      type: "line" as const,
      smooth: false,
      showSymbol: false,
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
        trigger: "axis",
        formatter: (params: unknown) => {
          if (!Array.isArray(params) || params.length === 0) return ""
          const axisValue = String(params[0].axisValue ?? "")
          const lines = params.map((item) => {
            const value =
              typeof item.value === "number" ? item.value : Number(item.value)
            return `${item.seriesName}: ${formatCurrency(value)}`
          })
          return [axisValue, ...lines].join("\n")
        },
      },
      legend: {
        type: "scroll",
        top: 0,
        data: series.map((s) => s.name),
      },
      grid: { left: 48, right: 16, bottom: 40, top: 48 },
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
  }, [months, series])

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
