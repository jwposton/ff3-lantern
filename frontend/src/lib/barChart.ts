import type { OmniRow } from "@/types/NormalizedTransaction"

import { enumerateMonths, monthKey } from "@/lib/trends"

const UNCategorized_LABEL = "Uncategorized"

export type BarChartData = {
  months: string[]
  stacks: string[]
  data: Record<string, Record<string, number>>
}

export type BuildBarChartOptions = {
  start: string
  end: string
  filter?: { budget?: string }
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

function stackLabel(
  row: OmniRow,
  stackField: "budget" | "category",
): string {
  return stackField === "budget"
    ? budgetLabel(row.budget)
    : categoryLabel(row.category)
}

export function buildBarChartData(
  rows: OmniRow[],
  groupBy: ["month", "budget"] | ["month", "category"],
  options: BuildBarChartOptions,
): BarChartData {
  const [, stackField] = groupBy
  const months = enumerateMonths(options.start, options.end)

  let filtered = rows
  if (options.filter?.budget) {
    const targetBudget = options.filter.budget
    filtered = filtered.filter(
      (tx) => budgetLabel(tx.budget) === targetBudget,
    )
  }

  const stackTotals = new Map<string, number>()
  for (const row of filtered) {
    const stack = stackLabel(row, stackField)
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
    const stack = stackLabel(row, stackField)
    if (!data[month] || data[month][stack] === undefined) continue
    data[month][stack] += parseAmount(row.amount)
  }

  return { months, stacks, data }
}
