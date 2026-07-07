import type { OmniRow } from "@/types/NormalizedTransaction"

import {
  cashFlowBudgetLabel,
  cashFlowCategoryLabel,
} from "@/lib/cashFlowLabels"
import {
  isSpendingCashRail,
  isSpendingCreditRail,
  type PaymentRail,
} from "@/lib/spendingRail"
import { isCashFlowInflow } from "@/lib/spending"
import { enumerateMonths, monthKey } from "@/lib/trends"

const UNCategorized_LABEL = "Uncategorized"

export type BarChartData = {
  months: string[]
  stacks: string[]
  data: Record<string, Record<string, number>>
}

export type SplitBarChartData = {
  months: string[]
  stacks: string[]
  cashData: Record<string, Record<string, number>>
  creditData: Record<string, Record<string, number>>
}

export type TrendLineSeries = {
  name: string
  data: number[]
  dashed?: boolean
}

export const TOTAL_LABEL = "Total"
export const INCOME_LINE_LABEL = "Income"
/** Aligns with dashboard KPI positive cash styling (emerald-500). */
export const INCOME_LINE_COLOR = "#10b981"

export type LineSeriesOptions = {
  includeTotal?: boolean
}

export type DrilldownFilter = {
  budget?: string
  category?: string
  payee?: string
  paymentRail?: PaymentRail
}

export type StackDimension = "budget" | "category" | "payee"

export type BuildBarChartOptions = {
  start: string
  end: string
  filter?: DrilldownFilter
  /** Use cash-flow budget/category labels (CC Payment, payee fallback) for stacks and drilldown filter. */
  useCashFlowLabels?: boolean
}

function parseAmount(amount: string | null): number {
  if (amount == null) return 0
  return parseFloat(amount)
}

function budgetLabel(budget: string | null): string {
  if (budget == null || budget === "") return UNCategorized_LABEL
  return budget
}

function categoryLabel(category: string | null): string {
  if (category == null || category === "") return UNCategorized_LABEL
  return category
}

function payeeLabel(row: OmniRow): string {
  const dest = (row.destination_account ?? "").trim()
  return dest || UNCategorized_LABEL
}

function stackLabel(
  row: OmniRow,
  stackField: StackDimension,
  useCashFlowLabels: boolean,
): string {
  if (useCashFlowLabels) {
    if (stackField === "budget") return cashFlowBudgetLabel(row)
    if (stackField === "category") return cashFlowCategoryLabel(row)
    return payeeLabel(row)
  }
  if (stackField === "budget") return budgetLabel(row.budget)
  if (stackField === "category") return categoryLabel(row.category)
  return payeeLabel(row)
}

export function filterRowsForDrilldown(
  rows: OmniRow[],
  filter: DrilldownFilter,
  useCashFlowLabels: boolean,
): OmniRow[] {
  return rows.filter((row) => {
    if (
      filter.budget != null &&
      stackLabel(row, "budget", useCashFlowLabels) !== filter.budget
    ) {
      return false
    }
    if (
      filter.category != null &&
      stackLabel(row, "category", useCashFlowLabels) !== filter.category
    ) {
      return false
    }
    if (
      filter.payee != null &&
      stackLabel(row, "payee", useCashFlowLabels) !== filter.payee
    ) {
      return false
    }
    if (filter.paymentRail === "cash" && !isSpendingCashRail(row)) {
      return false
    }
    if (filter.paymentRail === "credit" && !isSpendingCreditRail(row)) {
      return false
    }
    return true
  })
}

export function buildBarChartData(
  rows: OmniRow[],
  groupBy: ["month", StackDimension],
  options: BuildBarChartOptions,
): BarChartData {
  const [, stackField] = groupBy
  const months = enumerateMonths(options.start, options.end)

  const useCashFlowLabels = options.useCashFlowLabels === true
  let filtered = rows
  if (options.filter) {
    filtered = filterRowsForDrilldown(filtered, options.filter, useCashFlowLabels)
  }

  const stackTotals = new Map<string, number>()
  for (const row of filtered) {
    const stack = stackLabel(row, stackField, useCashFlowLabels)
    stackTotals.set(
      stack,
      (stackTotals.get(stack) ?? 0) + parseAmount(row.amount),
    )
  }

  const stacks = [...stackTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)

  const data: Record<string, Record<string, number>> = {}
  for (const month of months) {
    data[month] = {}
    for (const stack of stacks) {
      data[month][stack] = 0
    }
  }

  for (const row of filtered) {
    const month = monthKey(row.date)
    const stack = stackLabel(row, stackField, useCashFlowLabels)
    if (!data[month] || data[month][stack] === undefined) continue
    data[month][stack] += parseAmount(row.amount)
  }

  return { months, stacks, data }
}

export function buildSplitBarChartData(
  rows: OmniRow[],
  options: BuildBarChartOptions,
): SplitBarChartData {
  const months = enumerateMonths(options.start, options.end)
  const useCashFlowLabels = options.useCashFlowLabels === true

  let filtered = rows
  if (options.filter) {
    filtered = filterRowsForDrilldown(filtered, options.filter, useCashFlowLabels)
  }

  const stackTotals = new Map<string, number>()
  for (const row of filtered) {
    const stack = stackLabel(row, "budget", useCashFlowLabels)
    stackTotals.set(
      stack,
      (stackTotals.get(stack) ?? 0) + parseAmount(row.amount),
    )
  }

  const stacks = [...stackTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)

  const emptyMonthStacks = (): Record<string, number> =>
    Object.fromEntries(stacks.map((stack) => [stack, 0]))

  const cashData: Record<string, Record<string, number>> = {}
  const creditData: Record<string, Record<string, number>> = {}
  for (const month of months) {
    cashData[month] = emptyMonthStacks()
    creditData[month] = emptyMonthStacks()
  }

  for (const row of filtered) {
    const month = monthKey(row.date)
    if (!cashData[month]) continue
    const stack = stackLabel(row, "budget", useCashFlowLabels)
    if (cashData[month][stack] === undefined) continue
    const amount = parseAmount(row.amount)
    if (isSpendingCashRail(row)) {
      cashData[month][stack] += amount
    } else if (isSpendingCreditRail(row)) {
      creditData[month][stack] += amount
    }
  }

  return { months, stacks, cashData, creditData }
}

function hasNonZeroSplitStacks(chartData: SplitBarChartData): boolean {
  const { months, stacks, cashData, creditData } = chartData
  return stacks.some((stack) =>
    months.some(
      (month) =>
        (cashData[month]?.[stack] ?? 0) > 0 ||
        (creditData[month]?.[stack] ?? 0) > 0,
    ),
  )
}

export function splitBarChartIsEmpty(chartData: SplitBarChartData): boolean {
  return !hasNonZeroSplitStacks(chartData)
}

/** Monthly bank inflow totals aligned with {@link enumerateMonths} for chart overlays. */
export function buildMonthlyIncomeTotals(
  rows: OmniRow[],
  start: string,
  end: string,
): number[] {
  const months = enumerateMonths(start, end)
  const totals = new Map(months.map((month) => [month, 0]))
  for (const row of rows) {
    if (!isCashFlowInflow(row)) continue
    const month = monthKey(row.date)
    if (!totals.has(month)) continue
    totals.set(month, (totals.get(month) ?? 0) + parseAmount(row.amount))
  }
  return months.map((month) => totals.get(month) ?? 0)
}

export function stackTotalsAcrossMonths(
  chartData: BarChartData,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const stack of chartData.stacks) {
    totals.set(
      stack,
      chartData.months.reduce(
        (sum, month) => sum + (chartData.data[month]?.[stack] ?? 0),
        0,
      ),
    )
  }
  return totals
}

export function barChartDataToLineSeries(
  chartData: BarChartData,
  options?: LineSeriesOptions,
): TrendLineSeries[] {
  const { months, stacks, data } = chartData
  const series: TrendLineSeries[] = stacks.map((stack) => ({
    name: stack,
    data: months.map((month) => data[month]?.[stack] ?? 0),
  }))

  if (options?.includeTotal) {
    const totalData = months.map((month) =>
      stacks.reduce((sum, stack) => sum + (data[month]?.[stack] ?? 0), 0),
    )
    series.push({ name: TOTAL_LABEL, data: totalData, dashed: true })
  }

  return series
}
