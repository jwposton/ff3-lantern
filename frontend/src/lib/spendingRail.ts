import type { OmniRow } from "@/types/NormalizedTransaction"

import { isCreditCard } from "@/lib/accounts"
import { isSpendingExpense, isSpendingWithdrawal } from "@/lib/spending"

export type PaymentRail = "cash" | "credit"

export function paymentRailLabel(rail: PaymentRail): string {
  return rail === "cash" ? "Cash" : "Credit"
}

export function isSpendingCashRail(row: OmniRow): boolean {
  return isSpendingWithdrawal(row)
}

export function isSpendingCreditRail(row: OmniRow): boolean {
  return (
    isSpendingExpense(row) &&
    isCreditCard(row.source_type, row.source_role)
  )
}

export function rowMatchesPaymentRail(
  row: OmniRow,
  rail: PaymentRail,
): boolean {
  return rail === "cash" ? isSpendingCashRail(row) : isSpendingCreditRail(row)
}
