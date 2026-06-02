import type { OmniRow } from "@/types/NormalizedTransaction"

/** Matches backend transactions_withdrawal.json → normalize → spending row (75.50). */
export const mainCheckingWithdrawal: OmniRow = {
  amount: "75.50",
  type: "withdrawal",
  source_account: "Main Checking",
  source_type: "Asset account",
  source_role: "Default account",
  destination_account: "Grocery Store",
  destination_type: "Expense account",
  destination_role: null,
  budget: "Essentials",
  category: "Food",
  date: "2024-01-15",
}

/** Credit card source — excluded from spending_withdrawal_total. */
export const creditCardWithdrawal: OmniRow = {
  amount: "100.00",
  type: "withdrawal",
  source_account: "Chase VISA",
  source_type: "Asset account",
  source_role: "Credit card",
  destination_account: "Store",
  destination_type: "Expense account",
  destination_role: null,
  budget: null,
  category: "Shopping",
  date: "2024-01-16",
}

export const transportWithdrawal: OmniRow = {
  amount: "30.00",
  type: "withdrawal",
  source_account: "Main Checking",
  source_type: "Asset account",
  source_role: "Default account",
  destination_account: "Gas Station",
  destination_type: "Expense account",
  destination_role: null,
  budget: null,
  category: "Transport",
  date: "2024-01-17",
}

export const uncategorizedWithdrawal: OmniRow = {
  amount: "20.00",
  type: "withdrawal",
  source_account: "Main Checking",
  source_type: "Asset account",
  source_role: "Default account",
  destination_account: "Misc",
  destination_type: "Expense account",
  destination_role: null,
  budget: null,
  category: null,
  date: "2024-01-18",
}

/** Rows mirroring backend pytest total (75.50 ±0.01). */
export const spendingRowsForTotal: OmniRow[] = [
  mainCheckingWithdrawal,
  creditCardWithdrawal,
]

/** Multiple categories for topCategoryBySpend tests. */
export const spendingRowsForTopCategory: OmniRow[] = [
  mainCheckingWithdrawal,
  transportWithdrawal,
  uncategorizedWithdrawal,
  creditCardWithdrawal,
]
