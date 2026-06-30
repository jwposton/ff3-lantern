import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { BarChartData } from "@/lib/barChart"
import { CHART_COLORS } from "@/lib/chartColors"
import { formatCurrency } from "@/lib/spending"

type SpendingBarChartProps = {
  chartData: BarChartData
  loading: boolean
  emptyMessage: string
  onSelect: (budget: string) => void
  chartTitle?: string
  yAxisName?: string
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

function hasNonZeroStacks(chartData: BarChartData): boolean {
  const { months, stacks, data } = chartData
  return stacks.some((stack) =>
    months.some((month) => (data[month]?.[stack] ?? 0) > 0),
  )
}

export function SpendingBarChart({
  chartData,
  loading,
  emptyMessage,
  onSelect,
  chartTitle = "Spending by month",
  yAxisName = "Spending",
}: SpendingBarChartProps) {
  const { months, stacks, data } = chartData
  const isEmpty = !loading && !hasNonZeroStacks(chartData)

  const option = useMemo((): EChartsOption => {
    const monthlyTotals = months.map((month) =>
      stacks.reduce((sum, stack) => sum + (data[month]?.[stack] ?? 0), 0),
    )

    const echartsSeries = stacks.map((stack, idx) => {
      const isTopStack = idx === stacks.length - 1 && stacks.length > 0
      return {
        name: stack,
        type: "bar" as const,
        stack: "total",
        barMaxWidth: 38,
        data: months.map((month) => data[month]?.[stack] ?? 0),
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
        data: stacks,
        selectedMode: false,
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
  }, [months, stacks, data, yAxisName])

  function handleClick(params: {
    componentType?: string
    seriesName?: string
    name?: string
  }) {
    if (params.componentType === "legend" && params.name) {
      onSelect(params.name)
      return
    }
    if (params?.seriesName) {
      onSelect(params.seriesName)
    }
  }

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
            option={option}
            style={{ height: 380, width: "100%" }}
            onEvents={{ click: handleClick }}
            notMerge
            lazyUpdate
          />
        )}
      </CardContent>
    </Card>
  )
}
