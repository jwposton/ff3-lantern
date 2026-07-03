import type { DestinationMatchType, FilterState } from "@/lib/transactionTable"
import { EMPTY_FILTERS } from "@/lib/transactionTable"

const DESTINATION_MATCH_TYPES: DestinationMatchType[] = [
  "contains",
  "starts_with",
  "ends_with",
  "is",
]

function isDestinationMatchType(value: string): value is DestinationMatchType {
  return DESTINATION_MATCH_TYPES.includes(value as DestinationMatchType)
}

export type ParsedExplorerUrl = {
  filters: FilterState
  showAllTypes: boolean
  fromUrl: boolean
}

export function matchesCategorizeQueue(row: {
  type: string | null
  category: string | null
  budget: string | null
}): boolean {
  if (row.type !== "withdrawal") return false
  const cat = row.category?.trim()
  const budget = row.budget?.trim()
  if (cat?.startsWith("Transfer to ")) return false
  if (budget === "Credit Card Payment") return false
  return !cat || !budget
}

export function parseExplorerFiltersFromSearchParams(
  params: URLSearchParams,
): ParsedExplorerUrl {
  const filters: FilterState = { ...EMPTY_FILTERS }
  let showAllTypes = false
  let fromUrl = false

  if (params.get("categorize_queue") === "1") {
    filters.categorize_queue_only = true
    fromUrl = true
  }
  if (params.get("uncategorized_only") === "1") {
    filters.uncategorized_only = true
    fromUrl = true
  }
  const type = params.get("type")
  if (type) {
    filters.transaction_type = type
    fromUrl = true
  }
  const amount = params.get("amount")
  if (amount) {
    filters.amount_exact = amount
    fromUrl = true
  }
  const description = params.get("description")
  if (description) {
    filters.description_contains = description
    fromUrl = true
  }
  const destination = params.get("destination")
  if (destination) {
    filters.destination_account = destination
    fromUrl = true
  }
  const destMatch = params.get("dest_match")
  if (destMatch && isDestinationMatchType(destMatch)) {
    filters.destination_match_type = destMatch
    fromUrl = true
  }
  const categories = params.get("categories")
  if (categories) {
    filters.categories = categories.split("|").filter(Boolean)
    fromUrl = true
  }
  const budget = params.get("budget")
  if (budget) {
    filters.budget = budget
    fromUrl = true
  }
  const account = params.get("account")
  if (account) {
    filters.account = account
    fromUrl = true
  }
  const search = params.get("search")
  if (search) {
    filters.search = search
    fromUrl = true
  }
  if (params.get("show_all_types") === "1") {
    showAllTypes = true
    fromUrl = true
  }

  return { filters, showAllTypes, fromUrl }
}

export function appendExplorerFiltersToSearchParams(
  params: URLSearchParams,
  filters: FilterState,
  showAllTypes: boolean,
): void {
  if (filters.categorize_queue_only) params.set("categorize_queue", "1")
  if (filters.uncategorized_only) params.set("uncategorized_only", "1")
  if (filters.transaction_type) params.set("type", filters.transaction_type)
  if (filters.amount_exact.trim()) params.set("amount", filters.amount_exact.trim())
  if (filters.description_contains.trim()) {
    params.set("description", filters.description_contains.trim())
  }
  if (filters.destination_account.trim()) {
    params.set("destination", filters.destination_account.trim())
  }
  if (filters.destination_match_type !== "contains") {
    params.set("dest_match", filters.destination_match_type)
  }
  if (filters.categories.length > 0) {
    params.set("categories", filters.categories.join("|"))
  }
  if (filters.budget) params.set("budget", filters.budget)
  if (filters.account) params.set("account", filters.account)
  if (filters.search.trim()) params.set("search", filters.search.trim())
  if (showAllTypes) params.set("show_all_types", "1")
}

export function buildTransactionExplorerPath(
  start: string,
  end: string,
  filters?: Partial<FilterState>,
  options?: { showAllTypes?: boolean },
): string {
  const params = new URLSearchParams({ start, end })
  appendExplorerFiltersToSearchParams(
    params,
    { ...EMPTY_FILTERS, ...filters },
    options?.showAllTypes ?? false,
  )
  return `/reports/transactions?${params.toString()}`
}

/** Same rows as the Categorize queue: withdrawals missing category and/or budget. */
export function buildCategorizeExplorerPath(start: string, end: string): string {
  return buildTransactionExplorerPath(start, end, {
    categorize_queue_only: true,
  })
}
