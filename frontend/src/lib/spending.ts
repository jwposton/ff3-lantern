import type { OmniRow } from "@/types/NormalizedTransaction"

import { isCreditCardPaymentFlow } from "@/lib/cashFlowLabels"
import { isBankAccount, isCreditCard, isSpendingBankAccount } from "@/lib/accounts"

export function isSpendingWithdrawal(row: OmniRow): boolean {
  return (
    row.type === "withdrawal" &&
    row.source_type === "Asset account" &&
    row.source_role !== "Credit card"
  )
}

/**
 * Cash Flow bar/line population: cash leaving bank accounts — withdrawals to
 * expense/liability and transfers to any non-bank destination (CC payments,
 * liability payments, etc.). Excludes deposits/inflows, CC purchases, and bank↔bank moves.
 * Cash Flow Sankey uses {@link isCashMovementRow} instead (includes deposits).
 */
export function isCashFlowOutflow(row: OmniRow): boolean {
  if (isCreditCard(row.source_type, row.source_role)) return false

  const sourceIsBank = isBankAccount(row.source_type, row.source_role)
  if (!sourceIsBank) return false

  if (row.type === "withdrawal") {
    // Card purchases mislabeled as bank (missing credit-card role) must not count as cash flow
    if (
      row.destination_type === "Expense account" &&
      !isSpendingBankAccount(row.source_type, row.source_role)
    ) {
      return false
    }
    return true
  }

  if (row.type === "transfer") {
    if (isCreditCardPaymentFlow(row)) return true
    const destIsBank = isBankAccount(row.destination_type, row.destination_role)
    return !destIsBank
  }

  return false
}

/** Bank inflows: deposits and transfers into checking/savings from non-bank sources. */
export function isCashFlowInflow(row: OmniRow): boolean {
  if (isCreditCard(row.source_type, row.source_role)) return false

  const sourceIsBank = isBankAccount(row.source_type, row.source_role)
  const destIsBank = isBankAccount(row.destination_type, row.destination_role)

  if (row.type === "deposit") {
    return !sourceIsBank && destIsBank
  }
  if (row.type === "transfer") {
    return !sourceIsBank && destIsBank
  }
  return false
}

/** @deprecated Use isCashFlowOutflow — kept for legacy trend helpers. */
export function isTrendCashOutflow(row: OmniRow): boolean {
  return isCashFlowOutflow(row)
}

/**
 * Spending chart population (bar, line, sankey): all asset-account withdrawals
 * including credit card purchases; excludes transfers and deposits.
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

function sumRowAmounts(rows: OmniRow[], predicate: (row: OmniRow) => boolean): number {
  return rows.reduce((sum, row) => {
    if (!predicate(row)) return sum
    const amount = row.amount
    if (amount == null) return sum
    return sum + parseFloat(amount)
  }, 0)
}

export function spendingExpenseTotal(rows: OmniRow[]): number {
  return sumRowAmounts(rows, isSpendingExpense)
}

export function cashFlowInflowTotal(rows: OmniRow[]): number {
  return sumRowAmounts(rows, isCashFlowInflow)
}

export function cashFlowOutflowTotal(rows: OmniRow[]): number {
  return sumRowAmounts(rows, isCashFlowOutflow)
}

export function netCashFlowTotal(rows: OmniRow[]): number {
  return cashFlowInflowTotal(rows) - cashFlowOutflowTotal(rows)
}

export type MonthCashFlowKpi = {
  netCashFlow: number
  income: number
  cashOutflow: number
  spending: number
}

export function monthCashFlowKpi(rows: OmniRow[]): MonthCashFlowKpi {
  return {
    netCashFlow: netCashFlowTotal(rows),
    income: cashFlowInflowTotal(rows),
    cashOutflow: cashFlowOutflowTotal(rows),
    spending: spendingExpenseTotal(rows),
  }
}

export function formatSignedCurrency(value: number): string {
  const abs = formatCurrency(Math.abs(value))
  if (value > 0) return `+${abs}`
  if (value < 0) return `-${abs}`
  return abs
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
