import type { BudgetSpendSlice } from "@/components/BudgetSpendPieChart"
import { buildBarChartData, stackTotalsAcrossMonths } from "@/lib/barChart"
import { aggregateOtherAmounts, rankStacksByAmount } from "@/lib/momVariance"
import type { OmniRow } from "@/types/NormalizedTransaction"

/** Rows whose `date` falls in `YYYY-MM`. */
export function filterRowsInCalendarMonth(
  rows: OmniRow[],
  month: string,
): OmniRow[] {
  return rows.filter((row) => (row.date ?? "").startsWith(month))
}

export type BuildBudgetPieSlicesOptions = {
  rowFilter: (row: OmniRow) => boolean
  useCashFlowLabels?: boolean
  topN?: number
}

/** Aggregate rows into budget pie slices for a date window. */
export function buildBudgetPieSlices(
  rows: OmniRow[],
  start: string,
  end: string,
  options: BuildBudgetPieSlicesOptions,
): BudgetSpendSlice[] {
  const topN = options.topN ?? 15
  const filtered = rows.filter(options.rowFilter)
  if (filtered.length === 0) return []

  const chartData = buildBarChartData(filtered, ["month", "budget"], {
    start,
    end,
    useCashFlowLabels: options.useCashFlowLabels === true,
  })
  const totals = stackTotalsAcrossMonths(chartData)
  const { names } = rankStacksByAmount(totals, topN)
  const aggregated = aggregateOtherAmounts(totals, names)
  return names
    .filter((name) => aggregated.has(name))
    .map((name) => ({ name, value: aggregated.get(name) ?? 0 }))
    .filter((slice) => slice.value > 0)
}
