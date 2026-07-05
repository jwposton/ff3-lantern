import { useCallback, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { BarChartData } from "@/lib/barChart"
import {
  INCOME_LINE_COLOR,
  INCOME_LINE_LABEL,
} from "@/lib/barChart"
import { CHART_COLORS } from "@/lib/chartColors"
import { categoryAxisColumnStripes } from "@/lib/chartStripes"
import {
  chartGridWithVerticalLegend,
  verticalRightLegend,
} from "@/lib/chartLegend"
import { formatCurrency } from "@/lib/spending"

type SpendingBarChartProps = {
  chartData: BarChartData
  loading: boolean
  emptyMessage: string
  onSelect: (budget: string) => void
  chartTitle?: string
  yAxisName?: string
  /** Monthly bank inflow totals (same length as chartData.months). Enables income line overlay. */
  monthlyIncome?: number[]
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

function incomeAwareItemTooltipFormatter(
  monthlyIncome: number[],
  incomeVisible: boolean,
) {
  return (params: unknown): string => {
    const item = Array.isArray(params) ? params[0] : params
    if (!item || typeof item !== "object") return ""
    const record = item as {
      seriesName?: string
      name?: string
      value?: unknown
      dataIndex?: number
    }
    const period = String(record.name ?? "")
    const lines = [
      `${record.seriesName}: ${formatCurrency(tooltipValue(record.value))}`,
    ]
    const appendIncome =
      incomeVisible &&
      record.seriesName !== INCOME_LINE_LABEL &&
      typeof record.dataIndex === "number"
    if (appendIncome) {
      lines.push(
        `${INCOME_LINE_LABEL}: ${formatCurrency(monthlyIncome[record.dataIndex] ?? 0)}`,
      )
    }
    return `${period}\n${lines.join("\n")}`
  }
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
  monthlyIncome,
}: SpendingBarChartProps) {
  const { months, stacks, data } = chartData
  const showIncomeLine = monthlyIncome != null
  const isEmpty = !loading && !hasNonZeroStacks(chartData)
  const chartRef = useRef<ReactECharts>(null)
  const [incomeLegendVisible, setIncomeLegendVisible] = useState(true)

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

    const legendLabels = showIncomeLine
      ? [...stacks, INCOME_LINE_LABEL]
      : stacks

    const incomeSeries = showIncomeLine
      ? [
          {
            name: INCOME_LINE_LABEL,
            type: "line" as const,
            data: monthlyIncome,
            showSymbol: true,
            symbolSize: 6,
            itemStyle: { color: INCOME_LINE_COLOR },
            lineStyle: { color: INCOME_LINE_COLOR, width: 2 },
            emphasis: { focus: "series" as const },
            z: 10,
          },
        ]
      : []

    return {
      tooltip: {
        trigger: "item",
        formatter: showIncomeLine
          ? incomeAwareItemTooltipFormatter(monthlyIncome, incomeLegendVisible)
          : itemTooltipFormatter,
      },
      legend: {
        ...verticalRightLegend(legendLabels),
        triggerEvent: true,
      },
      grid: chartGridWithVerticalLegend(legendLabels),
      xAxis: {
        type: "category",
        data: months,
        axisLabel: { rotate: 30 },
        ...categoryAxisColumnStripes(),
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
      series: [...echartsSeries, ...incomeSeries],
    }
  }, [months, stacks, data, yAxisName, showIncomeLine, monthlyIncome, incomeLegendVisible])

  const handleChartClick = useCallback(
    (params: { seriesName?: string }) => {
      if (!params?.seriesName || params.seriesName === INCOME_LINE_LABEL) return
      onSelect(params.seriesName)
    },
    [onSelect],
  )

  const handleLegendSelectChanged = useCallback(
    (params: { name?: string; selected?: Record<string, boolean> }) => {
      if (!params.name) return
      if (params.name === INCOME_LINE_LABEL) {
        setIncomeLegendVisible(params.selected?.[INCOME_LINE_LABEL] ?? true)
        return
      }
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
