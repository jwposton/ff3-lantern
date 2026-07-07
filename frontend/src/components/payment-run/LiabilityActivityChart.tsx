import { useMemo, useRef } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { LiabilityHistoryMonthly } from "@/lib/paymentRunApi"
import { parseHistoryAmount } from "@/lib/liabilityHistory"
import { CHART_COLORS } from "@/lib/chartColors"
import { categoryAxisColumnStripes } from "@/lib/chartStripes"
import {
  chartGridWithVerticalLegend,
  verticalRightLegend,
} from "@/lib/chartLegend"
import { formatCurrency } from "@/lib/spending"

type LiabilityActivityChartProps = {
  monthly: LiabilityHistoryMonthly[]
  loading: boolean
  emptyMessage?: string
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number)
  if (!year || !month) return monthKey
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
  })
}

export function LiabilityActivityChart({
  monthly,
  loading,
  emptyMessage = "No payments in this period",
}: LiabilityActivityChartProps) {
  const chartRef = useRef<ReactECharts>(null)
  const months = monthly.map((row) => row.month)
  const monthLabels = months.map(formatMonthLabel)
  const principal = monthly.map((row) => parseHistoryAmount(row.principal))
  const interest = monthly.map((row) => parseHistoryAmount(row.interest))
  const totalPayments = monthly.map((row) =>
    parseHistoryAmount(row.total_payment),
  )
  const hasData =
    principal.some((v) => v > 0) ||
    interest.some((v) => v > 0) ||
    totalPayments.some((v) => v > 0)

  const option = useMemo((): EChartsOption => {
    const legendLabels = ["Principal", "Interest", "Total payments"]
    const echartsSeries = [
      {
        name: "Principal",
        type: "line" as const,
        smooth: false,
        showSymbol: true,
        data: principal,
        itemStyle: { color: CHART_COLORS[0] },
      },
      {
        name: "Interest",
        type: "line" as const,
        smooth: false,
        showSymbol: true,
        data: interest,
        itemStyle: { color: CHART_COLORS[1] },
      },
      {
        name: "Total payments",
        type: "line" as const,
        smooth: false,
        showSymbol: true,
        data: totalPayments,
        itemStyle: { color: CHART_COLORS[2] },
      },
    ]

    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => formatCurrency(Number(value ?? 0)),
      },
      legend: verticalRightLegend(legendLabels),
      grid: chartGridWithVerticalLegend(legendLabels),
      xAxis: {
        type: "category",
        data: monthLabels,
        axisLabel: { interval: 0, rotate: months.length > 8 ? 45 : 0 },
        ...categoryAxisColumnStripes(),
      },
      yAxis: {
        type: "value",
        name: "Amount",
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
  }, [interest, monthLabels, months.length, principal, totalPayments])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments by month</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments by month</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payments by month</CardTitle>
      </CardHeader>
      <CardContent>
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: 280, width: "100%" }}
          notMerge
          lazyUpdate
        />
      </CardContent>
    </Card>
  )
}
