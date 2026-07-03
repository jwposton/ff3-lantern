import { isSpendingWithdrawal } from "@/lib/spending"
import type { OmniRow } from "@/types/NormalizedTransaction"

export type DestinationMatchType = "contains" | "starts_with" | "ends_with" | "is"

export type FilterState = {
  categories: string[]
  budget: string | null
  account: string | null
  search: string
  description_contains: string
  destination_account: string
  destination_match_type: DestinationMatchType
  transaction_type: string | null
  amount_exact: string
  uncategorized_only: boolean
}

export const EMPTY_FILTERS: FilterState = {
  categories: [],
  budget: null,
  account: null,
  search: "",
  description_contains: "",
  destination_account: "",
  destination_match_type: "contains",
  transaction_type: null,
  amount_exact: "",
  uncategorized_only: false,
}

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.categories.length > 0 ||
    filters.budget != null ||
    filters.account != null ||
    filters.search.trim() !== "" ||
    filters.description_contains.trim() !== "" ||
    filters.destination_account.trim() !== "" ||
    filters.transaction_type != null ||
    filters.amount_exact.trim() !== "" ||
    filters.uncategorized_only
  )
}

export function rowKey(row: OmniRow): string {
  return `${row.journal_id ?? ""}:${row.transaction_journal_id ?? ""}`
}

export function isRowEditable(row: OmniRow): boolean {
  return Boolean(row.journal_id && row.transaction_journal_id)
}

function distinctField(
  rows: OmniRow[],
  field: "category" | "budget" | "source_account",
): string[] {
  const values = new Set<string>()
  for (const row of rows) {
    const value = row[field]
    if (value != null && value !== "") {
      values.add(value)
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b))
}

export function distinctCategories(rows: OmniRow[]): string[] {
  return distinctField(rows, "category")
}

export function distinctBudgets(rows: OmniRow[]): string[] {
  return distinctField(rows, "budget")
}

export function distinctSourceAccounts(rows: OmniRow[]): string[] {
  return distinctField(rows, "source_account")
}

function normalizeAmount(value: string): number | null {
  const raw = value.trim().replace(",", ".")
  if (!raw) return null
  const n = parseFloat(raw)
  return Number.isFinite(n) ? Math.abs(n) : null
}

function destinationMatches(
  destName: string,
  needle: string,
  matchType: DestinationMatchType,
): boolean {
  const haystack = destName.trim()
  const n = needle.trim()
  if (!n) return true
  if (matchType === "is") return haystack === n
  const haystackLower = haystack.toLowerCase()
  const nLower = n.toLowerCase()
  if (matchType === "contains") return haystackLower.includes(nLower)
  if (matchType === "starts_with") return haystackLower.startsWith(nLower)
  if (matchType === "ends_with") return haystackLower.endsWith(nLower)
  return false
}

function isUncategorizedRow(row: OmniRow): boolean {
  const category = row.category?.trim()
  return !category
}

export function applyFilters(
  rows: OmniRow[],
  filters: FilterState,
): OmniRow[] {
  let result = rows

  if (filters.categories.length > 0) {
    result = result.filter(
      (row) =>
        row.category != null && filters.categories.includes(row.category),
    )
  }

  if (filters.budget != null) {
    result = result.filter((row) => row.budget === filters.budget)
  }

  if (filters.account != null) {
    result = result.filter((row) => row.source_account === filters.account)
  }

  if (filters.transaction_type != null) {
    result = result.filter((row) => row.type === filters.transaction_type)
  }

  if (filters.uncategorized_only) {
    result = result.filter(isUncategorizedRow)
  }

  const descNeedle = filters.description_contains.trim().toLowerCase()
  if (descNeedle !== "") {
    result = result.filter((row) =>
      (row.description ?? "").toLowerCase().includes(descNeedle),
    )
  }

  const destNeedle = filters.destination_account.trim()
  if (destNeedle !== "") {
    result = result.filter((row) =>
      destinationMatches(
        row.destination_account ?? "",
        destNeedle,
        filters.destination_match_type,
      ),
    )
  }

  const amountExact = normalizeAmount(filters.amount_exact)
  if (amountExact != null) {
    result = result.filter((row) => {
      const rowAmount = normalizeAmount(row.amount ?? "")
      return rowAmount != null && rowAmount === amountExact
    })
  }

  const search = filters.search.trim().toLowerCase()
  if (search !== "") {
    result = result.filter((row) => {
      const haystack = [
        row.category,
        row.budget,
        row.source_account,
        row.destination_account,
        row.description,
        row.amount,
        row.date,
      ]
        .filter((v) => v != null && v !== "")
        .map((v) => String(v).toLowerCase())
      return haystack.some((field) => field.includes(search))
    })
  }

  return result
}

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

export type SortKey =
  | "date"
  | "amount"
  | "type"
  | "category"
  | "budget"
  | "source_account"
  | "destination_account"

export type SortDir = "asc" | "desc"

export const PAGE_SIZE = 50

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
