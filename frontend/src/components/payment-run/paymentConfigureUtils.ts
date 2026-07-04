import type { BillRow, LiabilityRow } from "@/lib/paymentRunApi"

export type RegisteredBillRow = {
  registry_id: number
  name: string
  worksheet_section: string
  payment_rail: string
  funding_bucket_key: string | null
  credit_card_account_id: string | null
  amount_mode: string
}

export function toRegisteredBillRow(
  row: BillRow | LiabilityRow,
): RegisteredBillRow | null {
  if (!row.registry_id) return null
  const worksheetSection =
    "worksheet_section" in row && row.worksheet_section
      ? row.worksheet_section
      : "bills"
  return {
    registry_id: row.registry_id,
    name:
      row.row_label ??
      ("name" in row ? row.name : null) ??
      `Bill ${row.registry_id}`,
    worksheet_section: worksheetSection,
    payment_rail: row.payment_rail ?? "bank",
    funding_bucket_key: row.funding_bucket_key ?? null,
    credit_card_account_id: row.credit_card_account_id ?? null,
    amount_mode: row.amount_mode ?? "recurring",
  }
}

export function formatRailLabel(rail: string): string {
  return rail === "credit_card" ? "Credit card" : "Bank account"
}

export function formatSectionLabel(section: string): string {
  return section === "liabilities" ? "Liabilities" : "Bills"
}

export function formatAmountMode(mode: string): string {
  return mode === "intermittent" ? "Intermittent" : "Recurring"
}
