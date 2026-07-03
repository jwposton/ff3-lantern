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
  let showAllTypes = true
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
  const amountMin = params.get("amount_min")
  if (amountMin) {
    filters.amount_min = amountMin
    fromUrl = true
  }
  const amountMax = params.get("amount_max")
  if (amountMax) {
    filters.amount_max = amountMax
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
  if (params.get("show_all_types") === "0") {
    showAllTypes = false
    fromUrl = true
  }

  return { filters, showAllTypes, fromUrl }
}

export type ExplorerTriggerInput = {
  description_contains?: string
  destination_account?: string | null
  destination_match_type?: DestinationMatchType
  transaction_type?: string | null
  amount?: string | null
}

function normalizeTriggerAmount(value: string | null | undefined): string {
  if (!value) return ""
  const parsed = Math.abs(parseFloat(value.trim().replace(",", ".")))
  return Number.isFinite(parsed) ? parsed.toFixed(2) : ""
}

/** Explorer path with rule-style triggers (includes CC purchases via show all types). */
export function buildExplorerPathFromTriggers(
  start: string,
  end: string,
  triggers: ExplorerTriggerInput,
): string {
  const filters: Partial<FilterState> = {}
  const desc = triggers.description_contains?.trim()
  if (desc) filters.description_contains = desc
  const dest = triggers.destination_account?.trim()
  if (dest) {
    filters.destination_account = dest
    filters.destination_match_type = triggers.destination_match_type ?? "is"
  }
  if (triggers.transaction_type) {
    filters.transaction_type = triggers.transaction_type
  }
  const amount = normalizeTriggerAmount(triggers.amount)
  if (amount) filters.amount_exact = amount
  return buildTransactionExplorerPath(start, end, filters)
}

export function buildExplorerPathFromRuleDraft(
  start: string,
  end: string,
  draft: ExplorerTriggerInput & { description_contains?: string },
): string {
  return buildExplorerPathFromTriggers(start, end, draft)
}

export function buildExplorerPathFromPendingRow(
  start: string,
  end: string,
  row: {
    description?: string
    destination_name?: string | null
    type?: string | null
  },
): string {
  const desc = (row.description ?? "").trim()
  const dest = (row.destination_name ?? "").trim()
  return buildExplorerPathFromTriggers(start, end, {
    description_contains: desc || undefined,
    destination_account: dest || null,
    destination_match_type: "is",
    transaction_type:
      row.type === "withdrawal" || row.type === "deposit" ? row.type : "withdrawal",
  })
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
  if (filters.amount_min.trim()) params.set("amount_min", filters.amount_min.trim())
  if (filters.amount_max.trim()) params.set("amount_max", filters.amount_max.trim())
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
  if (!showAllTypes) params.set("show_all_types", "0")
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
    options?.showAllTypes ?? true,
  )
  return `/reports/transactions?${params.toString()}`
}

/** Same rows as the Categorize queue: withdrawals missing category and/or budget. */
export function buildCategorizeExplorerPath(start: string, end: string): string {
  return buildTransactionExplorerPath(start, end, {
    categorize_queue_only: true,
  })
}

const STRUCTURED_QUERY_PATTERN =
  /\b(uncategorized|category|categories|budget|deposit|withdrawals?|transfers?|amount|exactly|\$|source\s+account|from\s+checking|destination\s+account|payee|description\s+contains|memo\s+includes?)\b/i

const STRUCTURED_NON_AMOUNT_PATTERN =
  /\b(uncategorized|category|categories|budget|deposit|withdrawals?|transfers?|source\s+account|from\s+checking|destination\s+account|payee|description\s+contains|memo\s+includes?)\b/i

const AMOUNT_TRAILING_PATTERN =
  /(?:\s+or\s+|\s+and\s+)*(?:amount\s+(?:is\s+)?)?\$?(\d+(?:\.\d{1,2})?)\s*$/i

const AMOUNT_LEADING_PATTERN = /^\$?(\d+(?:\.\d{1,2})?)\s+and\s+/i

const OR_SPLIT_PATTERN = /\s+or\s+|\|/i

const AMOUNT_BETWEEN_PATTERN =
  /(?:(?:amount|value)\s+)?(?:between|from)\s+\$?(\d+(?:\.\d{1,2})?)\s+(?:and|to)\s+\$?(\d+(?:\.\d{1,2})?)/i

const AMOUNT_DASH_PATTERN = /\$?(\d+(?:\.\d{1,2})?)\s*[-–]\s*\$?(\d+(?:\.\d{1,2})?)/i

const AMOUNT_OVER_TRAILING_PATTERN =
  /(?:\s+or\s+|\s+and\s+)*(?:(?:amount|value)\s+)?(?:over|above|more than|greater than|at least)\s+\$?(\d+(?:\.\d{1,2})?)\s*$/i

const AMOUNT_UNDER_TRAILING_PATTERN =
  /(?:\s+or\s+|\s+and\s+)*(?:(?:amount|value)\s+)?(?:under|below|less than|at most|up to)\s+\$?(\d+(?:\.\d{1,2})?)\s*$/i

const AMOUNT_OVER_LEADING_PATTERN =
  /^(?:(?:amount|value)\s+)?(?:over|above|more than|greater than|at least)\s+\$?(\d+(?:\.\d{1,2})?)\s+(?:and\s+)?/i

const AMOUNT_UNDER_LEADING_PATTERN =
  /^(?:(?:amount|value)\s+)?(?:under|below|less than|at most|up to)\s+\$?(\d+(?:\.\d{1,2})?)\s+(?:and\s+)?/i

const AMOUNT_SEARCH_NOISE_PATTERN =
  /^(?:amount|value|exact(?:ly)?|price|cost)(?:\s+(?:is|of|for|between|over|under|above|below))?\s*$/i

export type ParsedAmountClauses = {
  amount_exact: string
  amount_min: string
  amount_max: string
}

const EMPTY_AMOUNT_CLAUSES: ParsedAmountClauses = {
  amount_exact: "",
  amount_min: "",
  amount_max: "",
}

function stripJoinerNoise(text: string): string {
  return stripAmountRemainder(
    text.replace(/^\s+and\s+/i, "").replace(/\s+and\s+$/i, "").trim(),
  )
}

export function isAmountSearchNoise(term: string): boolean {
  return AMOUNT_SEARCH_NOISE_PATTERN.test(term.trim())
}

export function stripAmountRemainder(text: string): string {
  let value = text.trim()
  if (!value || isAmountSearchNoise(value)) return ""
  value = value.replace(/^(?:amount|value)\s+/i, "").trim()
  if (isAmountSearchNoise(value)) return ""
  return value
}

function applyBetweenRange(
  amounts: ParsedAmountClauses,
  lo: string,
  hi: string,
): void {
  let low = formatExplorerAmount(lo)
  let high = formatExplorerAmount(hi)
  if (parseFloat(low) > parseFloat(high)) {
    ;[low, high] = [high, low]
  }
  amounts.amount_min = low
  amounts.amount_max = high
}

function extractExactAmount(text: string): {
  amount: string | null
  remainder: string
} {
  let amount: string | null = null
  const trailing = text.match(AMOUNT_TRAILING_PATTERN)
  if (trailing && trailing.index != null) {
    amount = formatExplorerAmount(trailing[1])
    text = text.slice(0, trailing.index).trim()
  }
  const leading = text.match(AMOUNT_LEADING_PATTERN)
  if (leading) {
    amount = formatExplorerAmount(leading[1])
    text = text.slice(leading[0].length).trim()
  }
  return { amount, remainder: text }
}

/** Extract exact/range amount clauses and return the remaining query text. */
export function parseAmountClauses(query: string): {
  amounts: ParsedAmountClauses
  remainder: string
} {
  let text = query.trim()
  const amounts: ParsedAmountClauses = { ...EMPTY_AMOUNT_CLAUSES }
  if (!text) return { amounts, remainder: "" }

  const between = text.match(AMOUNT_BETWEEN_PATTERN)
  if (between && between.index != null) {
    applyBetweenRange(amounts, between[1], between[2])
    text = stripJoinerNoise(
      `${text.slice(0, between.index)} ${text.slice(between.index + between[0].length)}`.trim(),
    )
    return { amounts, remainder: text }
  }

  const dash = text.match(AMOUNT_DASH_PATTERN)
  if (dash && dash.index != null) {
    applyBetweenRange(amounts, dash[1], dash[2])
    text = stripJoinerNoise(
      `${text.slice(0, dash.index)} ${text.slice(dash.index + dash[0].length)}`.trim(),
    )
    return { amounts, remainder: text }
  }

  while (true) {
    const over = text.match(AMOUNT_OVER_TRAILING_PATTERN)
    if (over && over.index != null) {
      amounts.amount_min = formatExplorerAmount(over[1])
      text = text.slice(0, over.index).trim()
      continue
    }
    const under = text.match(AMOUNT_UNDER_TRAILING_PATTERN)
    if (under && under.index != null) {
      amounts.amount_max = formatExplorerAmount(under[1])
      text = text.slice(0, under.index).trim()
      continue
    }
    break
  }

  const overLead = text.match(AMOUNT_OVER_LEADING_PATTERN)
  if (overLead) {
    amounts.amount_min = formatExplorerAmount(overLead[1])
    text = text.slice(overLead[0].length).trim()
  }
  const underLead = text.match(AMOUNT_UNDER_LEADING_PATTERN)
  if (underLead) {
    amounts.amount_max = formatExplorerAmount(underLead[1])
    text = text.slice(underLead[0].length).trim()
  }

  const hasRange = Boolean(amounts.amount_min || amounts.amount_max)
  if (!hasRange) {
    const exact = extractExactAmount(text)
    if (exact.amount) {
      amounts.amount_exact = exact.amount
      text = exact.remainder
    }
  }

  return { amounts, remainder: stripJoinerNoise(text) }
}

function hasParsedAmounts(amounts: ParsedAmountClauses): boolean {
  return Boolean(
    amounts.amount_exact || amounts.amount_min || amounts.amount_max,
  )
}

function formatExplorerAmount(raw: string): string {
  const parsed = parseFloat(raw.trim().replace(",", "."))
  return Number.isFinite(parsed) ? parsed.toFixed(2) : ""
}

function buildOrSearchString(text: string): string {
  if (!text.trim()) return ""
  const cleaned: string[] = []
  for (const part of text.split(OR_SPLIT_PATTERN)) {
    const segment = part.trim()
    if (!segment) continue
    const term = extractBroadSearchTerm(segment) || segment
    if (term && !isAmountSearchNoise(term)) cleaned.push(term)
  }
  return cleaned.join(" or ")
}

function hasStructuredExplorerFilters(filter: FilterState): boolean {
  return Boolean(
    filter.categories.length > 0 ||
      filter.budget ||
      filter.account ||
      filter.transaction_type ||
      filter.amount_exact.trim() ||
      filter.amount_min.trim() ||
      filter.amount_max.trim() ||
      filter.uncategorized_only,
  )
}

/** Skip AI when the query is OR keywords, amount filters, or both. */
export function tryDeterministicExplorerQuery(
  query: string,
): Partial<FilterState> | null {
  const trimmed = query.trim()
  if (!trimmed || STRUCTURED_NON_AMOUNT_PATTERN.test(trimmed)) return null

  const { amounts, remainder } = parseAmountClauses(trimmed)
  const search = buildOrSearchString(remainder)
  const hasOr = OR_SPLIT_PATTERN.test(remainder)

  if (!hasParsedAmounts(amounts) && !hasOr) return null
  if (!search && !hasParsedAmounts(amounts)) return null

  return {
    search,
    amount_exact: amounts.amount_exact,
    amount_min: amounts.amount_min,
    amount_max: amounts.amount_max,
  }
}

export function extractBroadSearchTerm(text: string): string {
  let value = text.trim()
  if (!value) return ""
  value = value
    .replace(
      /^(?:all\s+)?transactions?\s+(?:with|containing|matching|from|for)\s+/i,
      "",
    )
    .trim()
  value = value
    .replace(
      /\s+(?:charges?|purchases?|payments?|transactions?|subs?(?:cription)?s?)$/i,
      "",
    )
    .trim()
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim()
  }
  return value
}

function clearAmountSearchNoise(filter: FilterState): FilterState {
  const hasAmount =
    filter.amount_exact.trim() ||
    filter.amount_min.trim() ||
    filter.amount_max.trim()
  if (!hasAmount || !filter.search.trim() || !isAmountSearchNoise(filter.search)) {
    return filter
  }
  return { ...filter, search: "" }
}

/** Align AI-parsed filters with the general search box (search across all fields). */
export function normalizeAiParsedFilter(
  filter: Partial<FilterState>,
  query: string,
): FilterState {
  const deterministic = tryDeterministicExplorerQuery(query)
  if (deterministic) {
    return clearAmountSearchNoise({
      ...EMPTY_FILTERS,
      ...filter,
      ...deterministic,
      description_contains: "",
      destination_account: "",
      destination_match_type: "contains",
    })
  }

  const base: FilterState = { ...EMPTY_FILTERS, ...filter }

  const toSearchOnly = (keyword: string): FilterState => ({
    ...base,
    search: extractBroadSearchTerm(keyword) || keyword,
    description_contains: "",
    destination_account: "",
    destination_match_type: "contains",
  })

  const desc = base.description_contains.trim()
  const dest = base.destination_account.trim()
  const search = base.search.trim()

  if (hasStructuredExplorerFilters(base)) {
    if (desc && !search) return clearAmountSearchNoise(toSearchOnly(desc))
    return clearAmountSearchNoise(base)
  }

  if (search) return clearAmountSearchNoise(toSearchOnly(search))
  if (desc) return clearAmountSearchNoise(toSearchOnly(desc))
  if (dest) return clearAmountSearchNoise(toSearchOnly(dest))

  const keyword = extractBroadSearchTerm(query)
  if (keyword && !STRUCTURED_QUERY_PATTERN.test(query)) {
    return clearAmountSearchNoise({
      ...base,
      search: keyword,
      description_contains: "",
      destination_account: "",
      destination_match_type: "contains",
    })
  }

  return clearAmountSearchNoise(base)
}
