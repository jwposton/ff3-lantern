import type { OmniRow } from "@/types/NormalizedTransaction"

import { isTrendCashOutflow } from "@/lib/spending"

const UNCategorized_LABEL = "Uncategorized"
const OTHER_LABEL = "Other"
const TOTAL_LABEL = "Total"

function categoryLabel(category: string | null): string {
  if (category == null || category === "") return UNCategorized_LABEL
  return category
}

function parseAmount(amount: string | null): number {
  if (amount == null) return 0
  return parseFloat(amount)
}

export function monthKey(date: string): string {
  return date.slice(0, 7)
}

export function enumerateMonths(start: string, end: string): string[] {
  const months: string[] = []
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  const endY = Number(end.slice(0, 4))
  const endM = Number(end.slice(5, 7))
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return months
}

export function sumByMonth(
  rows: OmniRow[],
  months: string[],
): Map<string, number> {
  const totals = new Map(months.map((mo) => [mo, 0]))
  for (const row of rows) {
    const mo = monthKey(row.date)
    if (!totals.has(mo)) continue
    totals.set(mo, (totals.get(mo) ?? 0) + parseAmount(row.amount))
  }
  return totals
}

export function rankCategoriesByRangeTotal(
  rows: OmniRow[],
  topN: number,
): { series: string[]; includesOther: boolean } {
  const byCat = new Map<string, number>()
  for (const row of rows) {
    const label = categoryLabel(row.category)
    byCat.set(label, (byCat.get(label) ?? 0) + parseAmount(row.amount))
  }
  const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, topN).map(([name]) => name)
  const includesOther = sorted.length > topN
  return {
    series: includesOther ? [...top, OTHER_LABEL] : top,
    includesOther,
  }
}

export type TrendChartSeries = {
  name: string
  data: number[]
}

export type TrendSeriesResult = {
  months: string[]
  series: TrendChartSeries[]
  /** Dashed total overlay for category mode; null in total mode. */
  totalOverlay: TrendChartSeries | null
}

export type BuildTrendSeriesOptions = {
  rows: OmniRow[]
  start: string
  end: string
  mode: "total" | "category"
  topN?: number
}

function mapToSeriesData(
  totals: Map<string, number>,
  months: string[],
): number[] {
  return months.map((mo) => totals.get(mo) ?? 0)
}

function sumByMonthForCategory(
  rows: OmniRow[],
  months: string[],
  categoryNames: string[],
  topCategories: string[],
): TrendChartSeries[] {
  const topSet = new Set(topCategories)
  const includesOther = categoryNames.includes(OTHER_LABEL)
  const seriesMaps = new Map(
    categoryNames.map((name) => [name, new Map(months.map((mo) => [mo, 0]))]),
  )

  for (const row of rows) {
    const mo = monthKey(row.date)
    const label = categoryLabel(row.category)
    const bucket = topSet.has(label)
      ? label
      : includesOther
        ? OTHER_LABEL
        : null
    if (bucket == null || !seriesMaps.has(bucket)) continue
    const monthMap = seriesMaps.get(bucket)!
    if (!monthMap.has(mo)) continue
    monthMap.set(mo, (monthMap.get(mo) ?? 0) + parseAmount(row.amount))
  }

  return categoryNames.map((name) => ({
    name,
    data: mapToSeriesData(seriesMaps.get(name)!, months),
  }))
}

export function buildTrendSeries(
  options: BuildTrendSeriesOptions,
): TrendSeriesResult {
  const { rows, start, end, mode, topN = 8 } = options
  const cashRows = rows.filter(isTrendCashOutflow)
  const months = enumerateMonths(start, end)
  const monthlyTotals = sumByMonth(cashRows, months)
  const totalData = mapToSeriesData(monthlyTotals, months)

  if (mode === "total") {
    return {
      months,
      series: [{ name: TOTAL_LABEL, data: totalData }],
      totalOverlay: null,
    }
  }

  const { series: categoryNames } = rankCategoriesByRangeTotal(cashRows, topN)
  const topCategories = categoryNames.filter((name) => name !== OTHER_LABEL)
  const categorySeries = sumByMonthForCategory(
    cashRows,
    months,
    categoryNames,
    topCategories,
  )

  return {
    months,
    series: categorySeries,
    totalOverlay: { name: TOTAL_LABEL, data: totalData },
  }
}
