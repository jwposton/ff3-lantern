import { isSpendingWithdrawal } from "@/lib/spending"
import type { OmniRow } from "@/types/NormalizedTransaction"

export const PAGE_SIZE = 50

export type SortKey =
  | "date"
  | "amount"
  | "type"
  | "category"
  | "budget"
  | "source_account"
  | "destination_account"

export type SortDir = "asc" | "desc"

export function applyDefaultTypeScope(
  rows: OmniRow[],
  showAllTypes: boolean,
): OmniRow[] {
  if (showAllTypes) return rows
  return rows.filter(
    (row) => isSpendingWithdrawal(row) && row.type !== "transfer",
  )
}

function compareValues(
  a: OmniRow,
  b: OmniRow,
  key: SortKey,
  dir: SortDir,
): number {
  const sign = dir === "asc" ? 1 : -1

  if (key === "amount") {
    const av = a.amount != null ? parseFloat(a.amount) : 0
    const bv = b.amount != null ? parseFloat(b.amount) : 0
    return (av - bv) * sign
  }

  if (key === "date") {
    const av = a.date ?? ""
    const bv = b.date ?? ""
    return av.localeCompare(bv) * sign
  }

  const av = String(a[key] ?? "")
  const bv = String(b[key] ?? "")
  return av.localeCompare(bv) * sign
}

export function sortRows(
  rows: OmniRow[],
  sortKey: SortKey,
  sortDir: SortDir,
): OmniRow[] {
  return [...rows].sort((a, b) => compareValues(a, b, sortKey, sortDir))
}

export function paginateRows(
  rows: OmniRow[],
  pageIndex: number,
  pageSize: number = PAGE_SIZE,
): { pageRows: OmniRow[]; totalPages: number } {
  if (rows.length === 0) {
    return { pageRows: [], totalPages: 0 }
  }
  const totalPages = Math.ceil(rows.length / pageSize)
  const safeIndex = Math.min(Math.max(0, pageIndex), totalPages - 1)
  const start = safeIndex * pageSize
  return {
    pageRows: rows.slice(start, start + pageSize),
    totalPages,
  }
}
