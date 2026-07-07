import { useMemo, useRef } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { CreditCardHistoryMonthly } from "@/lib/paymentRunApi"
import { parseHistoryAmount } from "@/lib/creditCardHistory"
import { CHART_COLORS } from "@/lib/chartColors"
import { categoryAxisColumnStripes } from "@/lib/chartStripes"
import {
  chartGridWithVerticalLegend,
  verticalRightLegend,
} from "@/lib/chartLegend"
import { formatCurrency } from "@/lib/spending"

type CreditCardActivityChartProps = {
  monthly: CreditCardHistoryMonthly[]
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

export function CreditCardActivityChart({
  monthly,
  loading,
  emptyMessage = "No activity in this period",
}: CreditCardActivityChartProps) {
  const chartRef = useRef<ReactECharts>(null)
  const months = monthly.map((row) => row.month)
  const monthLabels = months.map(formatMonthLabel)
  const charges = monthly.map((row) => parseHistoryAmount(row.charges))
  const payments = monthly.map((row) => parseHistoryAmount(row.payments))
  const interest = monthly.map((row) => parseHistoryAmount(row.interest))
  const fees = monthly.map((row) => parseHistoryAmount(row.fees))
  const interestAndFees = interest.map((value, index) => value + fees[index]!)
  const hasData =
    charges.some((v) => v > 0) ||
    payments.some((v) => v > 0) ||
    interestAndFees.some((v) => v > 0)

  const option = useMemo((): EChartsOption => {
    const legendLabels = ["Charges", "Payments", "Interest + fees"]
    const echartsSeries = [
      {
        name: "Charges",
        type: "line" as const,
        smooth: false,
        showSymbol: true,
        data: charges,
        itemStyle: { color: CHART_COLORS[0] },
      },
      {
        name: "Payments",
        type: "line" as const,
        smooth: false,
        showSymbol: true,
        data: payments,
        itemStyle: { color: CHART_COLORS[1] },
      },
      {
        name: "Interest + fees",
        type: "line" as const,
        smooth: false,
        showSymbol: true,
        data: interestAndFees,
        itemStyle: { color: CHART_COLORS[2] },
      },
    ]

    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const items = Array.isArray(params) ? params : [params]
          if (items.length === 0) return ""
          const first = items[0] as { dataIndex?: number; name?: string }
          const index = first.dataIndex ?? 0
          const lines = [String(first.name ?? "")]
          for (const item of items) {
            const record = item as {
              seriesName?: string
              value?: number | string
            }
            const name = record.seriesName ?? ""
            const value = Number(record.value ?? 0)
            if (name === "Interest + fees" && fees[index]! > 0) {
              lines.push(
                `${name}: ${formatCurrency(value)} (interest ${formatCurrency(interest[index]!)}, fees ${formatCurrency(fees[index]!)})`,
              )
            } else {
              lines.push(`${name}: ${formatCurrency(value)}`)
            }
          }
          return lines.join("\n")
        },
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
  }, [
    charges,
    fees,
    interest,
    interestAndFees,
    monthLabels,
    months.length,
  ])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity by month</CardTitle>
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
          <CardTitle className="text-base">Activity by month</CardTitle>
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
        <CardTitle className="text-base">Activity by month</CardTitle>
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
