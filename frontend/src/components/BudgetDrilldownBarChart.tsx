import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { OmniRow } from "@/types/NormalizedTransaction"
import { buildBarChartData } from "@/lib/barChart"
import { CHART_COLORS } from "@/lib/chartColors"
import { formatCurrency } from "@/lib/spending"

type BudgetDrilldownBarChartProps = {
  rows: OmniRow[]
  budget: string
  start: string
  end: string
  onClear: () => void
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

export function BudgetDrilldownBarChart({
  rows,
  budget,
  start,
  end,
  onClear,
}: BudgetDrilldownBarChartProps) {
  const { months, stacks, data } = useMemo(
    () =>
      buildBarChartData(rows, ["month", "category"], {
        start,
        end,
        filter: { budget },
      }),
    [rows, budget, start, end],
  )

  const isEmpty = !hasNonZeroStacks(months, stacks, data)

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
        barMaxWidth: 36,
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
      },
      grid: { left: 48, right: 120, bottom: 40, top: 24 },
      xAxis: {
        type: "category",
        data: months,
        axisLabel: { rotate: 30 },
      },
      yAxis: {
        type: "value",
        name: "Spending",
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
  }, [months, stacks, data])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{budget} by category</CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClear}
          aria-label="Clear budget drilldown"
        >
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-[340px] items-center justify-center text-center text-sm text-muted-foreground">
            No category spending for this budget in this date range
          </div>
        ) : (
          <ReactECharts
            option={option}
            style={{ height: 340, width: "100%" }}
            notMerge
            lazyUpdate
          />
        )}
      </CardContent>
    </Card>
  )
}
