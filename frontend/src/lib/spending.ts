import type { OmniRow } from "@/types/NormalizedTransaction"

export function isSpendingWithdrawal(row: OmniRow): boolean {
  return (
    row.type === "withdrawal" &&
    row.source_type === "Asset account" &&
    row.source_role !== "Credit card"
  )
}

/** Expanded cash-outflow slice for trends (D-17): bank withdrawals + CC payment transfers. */
export function isTrendCashOutflow(row: OmniRow): boolean {
  if (
    row.type === "withdrawal" &&
    row.source_type === "Asset account" &&
    row.source_role !== "Credit card"
  ) {
    return true
  }
  if (row.type === "transfer" && row.destination_role === "Credit card") {
    return true
  }
  return false
}

/**
 * Spending bar slice (D-09–D-11): asset-account withdrawals including credit card
 * purchases; excludes transfers and deposits.
 */
export function isSpendingExpense(row: OmniRow): boolean {
  return row.type === "withdrawal" && row.source_type === "Asset account"
}

export function spendingWithdrawalTotal(rows: OmniRow[]): number {
  return rows.reduce((sum, row) => {
    if (!isSpendingWithdrawal(row)) return sum
    const amount = row.amount
    if (amount == null) return sum
    return sum + parseFloat(amount)
  }, 0)
}

export type TopCategoryResult = {
  name: string
  amount: number
  percentOfTotal: number
}

const UNCategorized_LABEL = "Uncategorized"

function categoryLabel(category: string | null): string {
  if (category == null || category === "") return UNCategorized_LABEL
  return category
}

export function topCategoryBySpend(rows: OmniRow[]): TopCategoryResult {
  const spendingRows = rows.filter(isSpendingWithdrawal)
  const total = spendingWithdrawalTotal(spendingRows)

  const byCategory = new Map<string, number>()
  for (const row of spendingRows) {
    const label = categoryLabel(row.category)
    const amount = row.amount != null ? parseFloat(row.amount) : 0
    byCategory.set(label, (byCategory.get(label) ?? 0) + amount)
  }

  if (byCategory.size === 0) {
    return { name: UNCategorized_LABEL, amount: 0, percentOfTotal: 0 }
  }

  let topName = UNCategorized_LABEL
  let topAmount = 0
  for (const [name, amount] of byCategory) {
    if (amount > topAmount) {
      topName = name
      topAmount = amount
    }
  }

  return {
    name: topName,
    amount: topAmount,
    percentOfTotal: total === 0 ? 0 : topAmount / total,
  }
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}
