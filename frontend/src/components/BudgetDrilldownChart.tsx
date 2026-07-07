import { useCallback, useMemo, useRef } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { OmniRow } from "@/types/NormalizedTransaction"
import {
  barChartDataToLineSeries,
  buildBarChartData,
  type StackDimension,
} from "@/lib/barChart"
import { paymentRailLabel, type PaymentRail } from "@/lib/spendingRail"
import { CHART_COLORS } from "@/lib/chartColors"
import { categoryAxisColumnStripes } from "@/lib/chartStripes"
import {
  chartGridWithVerticalLegend,
  verticalRightLegend,
} from "@/lib/chartLegend"
import { formatCurrency } from "@/lib/spending"

export type BudgetDrilldownChartProps = {
  rows: OmniRow[]
  start: string
  end: string
  budget: string
  category?: string | null
  paymentRail?: PaymentRail
  stackField: Extract<StackDimension, "category" | "payee">
  chartType: "bar" | "line"
  useCashFlowLabels?: boolean
  yAxisName: string
  onSelect?: (value: string) => void
  onClear: () => void
  clearAriaLabel: string
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

function hasNonZeroStacks(
  months: string[],
  stacks: string[],
  data: Record<string, Record<string, number>>,
): boolean {
  return stacks.some((stack) =>
    months.some((month) => (data[month]?.[stack] ?? 0) > 0),
  )
}

export function BudgetDrilldownChart({
  rows,
  start,
  end,
  budget,
  category = null,
  paymentRail,
  stackField,
  chartType,
  useCashFlowLabels = false,
  yAxisName,
  onSelect,
  onClear,
  clearAriaLabel,
}: BudgetDrilldownChartProps) {
  const chartRef = useRef<ReactECharts>(null)

  const { months, stacks, data } = useMemo(
    () =>
      buildBarChartData(rows, ["month", stackField], {
        start,
        end,
        filter: {
          budget,
          ...(category != null ? { category } : {}),
          ...(paymentRail != null ? { paymentRail } : {}),
        },
        useCashFlowLabels,
      }),
    [rows, start, end, budget, category, paymentRail, stackField, useCashFlowLabels],
  )

  const isEmpty = !hasNonZeroStacks(months, stacks, data)

  const railSuffix =
    paymentRail != null ? ` · ${paymentRailLabel(paymentRail)}` : ""

  const title =
    stackField === "category"
      ? `${budget} by category${railSuffix}`
      : `${category} by payee${railSuffix}`

  const emptyMessage =
    stackField === "category"
      ? paymentRail != null
        ? `No ${paymentRailLabel(paymentRail).toLowerCase()} category spending for this budget in this date range`
        : "No category spending for this budget in this date range"
      : paymentRail != null
        ? `No ${paymentRailLabel(paymentRail).toLowerCase()} payee spending for this category in this date range`
        : "No payee spending for this category in this date range"

  const option = useMemo((): EChartsOption => {
    if (chartType === "line") {
      const lineSeries = barChartDataToLineSeries({ months, stacks, data })
      return {
        tooltip: {
          trigger: "item",
          formatter: itemTooltipFormatter,
        },
        legend: {
          ...verticalRightLegend(stacks),
          triggerEvent: Boolean(onSelect),
        },
        grid: chartGridWithVerticalLegend(stacks),
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
        series: lineSeries.map((item, idx) => ({
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
        })),
      }
    }

    const monthlyTotals = months.map((month) =>
      stacks.reduce((sum, stack) => sum + (data[month]?.[stack] ?? 0), 0),
    )

    const echartsSeries = stacks.map((stack, idx) => {
      const isTopStack = idx === stacks.length - 1 && stacks.length > 0
      return {
        name: stack,
        type: "bar" as const,
        stack: "total",
        barMaxWidth: 32,
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
        ...verticalRightLegend(stacks),
        triggerEvent: Boolean(onSelect),
      },
      grid: chartGridWithVerticalLegend(stacks),
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
      series: echartsSeries,
    }
  }, [chartType, months, stacks, data, yAxisName, onSelect])

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

  const onEvents = useMemo(
    () =>
      onSelect
        ? {
            click: handleChartClick,
            legendselectchanged: handleLegendSelectChanged,
          }
        : undefined,
    [handleChartClick, handleLegendSelectChanged, onSelect],
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClear}
          aria-label={clearAriaLabel}
        >
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-[340px] items-center justify-center text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: 340, width: "100%" }}
            onEvents={onEvents}
            notMerge
            lazyUpdate
          />
        )}
      </CardContent>
    </Card>
  )
}
