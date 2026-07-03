export type TransactionsMetaResponse = {
  categories: Array<{ id: string; name: string }>
  budgets: Array<{ id: string; name: string }>
  openrouter_configured?: boolean
  default_model?: string
  filter_parse_model?: string
}

export type ParsedExplorerFilter = {
  categories: string[]
  budget: string | null
  account: string | null
  search: string
  description_contains: string
  destination_account: string
  destination_match_type: "contains" | "starts_with" | "ends_with" | "is"
  transaction_type: string | null
  amount_exact: string
  uncategorized_only: boolean
}

export type ParseFilterResponse = {
  data: {
    filter: ParsedExplorerFilter
    rationale: string
  }
}

export type MassEditTarget = {
  journal_id: string
  transaction_journal_id: string
}

export type MassEditApplyResponse = {
  ok: boolean
  applied: number
  failed: number
  errors: Array<{
    journal_id: string
    transaction_journal_id: string
    error: string
  }>
}

export async function fetchTransactionsMeta(): Promise<TransactionsMetaResponse> {
  const res = await fetch("/api/transactions/meta")
  if (!res.ok) {
    throw new Error(`Failed to fetch transaction meta (${res.status})`)
  }
  return (await res.json()) as TransactionsMetaResponse
}

export async function applyMassEdit(body: {
  targets: MassEditTarget[]
  category_id?: string | null
  budget_id?: string | null
  clear_budget?: boolean
}): Promise<MassEditApplyResponse> {
  const res = await fetch("/api/transactions/mass-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as MassEditApplyResponse
  if (!res.ok && res.status !== 207) {
    const detail =
      typeof json === "object" && json != null && "detail" in json
        ? String((json as { detail: unknown }).detail)
        : `Mass edit failed (${res.status})`
    throw new Error(detail)
  }
  return json
}

export async function parseExplorerFilter(body: {
  query: string
  start: string
  end: string
}): Promise<ParseFilterResponse> {
  const res = await fetch("/api/transactions/parse-filter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const json = (await res.json()) as { detail?: string }
    throw new Error(json.detail ?? `Filter parse failed (${res.status})`)
  }
  return (await res.json()) as ParseFilterResponse
}
