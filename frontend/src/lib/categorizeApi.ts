export type PendingRow = {
  journal_id: string
  transaction_journal_id: string
  date: string
  amount: string
  description: string
  type: string
  source_name: string
  destination_name: string
  budget_name: string | null
}

export type CategorizeMetaResponse = {
  openrouter_configured: boolean
  categories: Array<{ id: string; name: string }>
  budgets: Array<{ id: string; name: string }>
  default_model: string
}

export type SuggestionPayload = {
  category: string
  budget: string | null
  confidence: number
  recommendation: "direct" | "rule"
  rationale: string
}

export type SuggestResultItem = {
  journal_id: string
  suggestion: SuggestionPayload | null
  cached: boolean
  error?: string
}

export type PendingResponse = {
  data: PendingRow[]
  meta: { count: number; start: string; end: string; limit: number }
}

export async function fetchPending(
  start: string,
  end: string,
): Promise<PendingResponse> {
  const params = new URLSearchParams({ start, end })
  const res = await fetch(`/api/categorize/pending?${params}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch pending queue (${res.status})`)
  }
  return (await res.json()) as PendingResponse
}

export async function fetchMeta(): Promise<CategorizeMetaResponse> {
  const res = await fetch("/api/categorize/meta")
  if (!res.ok) {
    throw new Error(`Failed to fetch categorize meta (${res.status})`)
  }
  return (await res.json()) as CategorizeMetaResponse
}

export async function suggestCategorizations(body: {
  start: string
  end: string
  journal_ids?: string[]
  limit?: number
  refresh?: boolean
}): Promise<{ data: SuggestResultItem[] }> {
  const res = await fetch("/api/categorize/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Suggest failed (${res.status})`)
  }
  return (await res.json()) as { data: SuggestResultItem[] }
}

export async function applyCategorization(
  journalId: string,
  body: {
    category_id: string
    transaction_journal_id: string
    budget_id?: string | null
  },
): Promise<{ ok: boolean; journal_id: string }> {
  const res = await fetch(`/api/categorize/${journalId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Apply failed (${res.status})`)
  }
  return (await res.json()) as { ok: boolean; journal_id: string }
}
