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

export type PendingGroup = {
  fingerprint: string
  count: number
  sample_description: string
  journal_ids: string[]
  rows: PendingRow[]
}

export type CategorizeMetaResponse = {
  openrouter_configured: boolean
  categories: Array<{ id: string; name: string }>
  budgets: Array<{ id: string; name: string }>
  default_model: string
}

export type DestinationMatchType = "contains" | "starts_with" | "ends_with" | "is"

export type RuleDraft = {
  title: string
  description_contains: string
  destination_account?: string | null
  destination_match_type?: DestinationMatchType
  transaction_type?: "withdrawal" | "deposit" | null
}

export type SuggestionPayload = {
  category: string
  budget: string | null
  confidence: number
  recommendation: "direct" | "rule"
  rationale: string
  rule?: RuleDraft | null
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

export type GroupedPendingResponse = {
  data: PendingGroup[]
  meta: {
    count: number
    group_count: number
    grouped: true
    start: string
    end: string
    limit: number
  }
}

export type RulePreviewCounts = {
  total: number
  uncategorized_count: number
  categorized_count: number
}

function apiErrorDetail(payload: { detail?: unknown }, fallback: string): string {
  const { detail } = payload
  if (typeof detail === "string") {
    const prefix = "Rule create failed: "
    if (detail.startsWith(prefix)) {
      return detail.slice(prefix.length)
    }
    const firefly = "Firefly API error "
    const idx = detail.indexOf(firefly)
    if (idx >= 0) {
      const rest = detail.slice(idx + firefly.length)
      const colon = rest.indexOf(": ")
      if (colon >= 0) {
        return rest.slice(colon + 2)
      }
    }
    return detail
  }
  if (detail && typeof detail === "object" && "message" in detail) {
    const message = (detail as { message?: string }).message
    if (message) return message
  }
  return fallback
}

export async function fetchPending(
  start: string,
  end: string,
  options?: { groupByFingerprint?: boolean },
): Promise<PendingResponse | GroupedPendingResponse> {
  const params = new URLSearchParams({ start, end })
  if (options?.groupByFingerprint) {
    params.set("group_by_fingerprint", "true")
  }
  const res = await fetch(`/api/categorize/pending?${params}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch pending queue (${res.status})`)
  }
  return (await res.json()) as PendingResponse | GroupedPendingResponse
}

export async function fetchMeta(): Promise<CategorizeMetaResponse> {
  const res = await fetch("/api/categorize/meta")
  if (!res.ok) {
    throw new Error(`Failed to fetch categorize meta (${res.status})`)
  }
  return (await res.json()) as CategorizeMetaResponse
}

export const SUGGEST_CHUNK_SIZE = 5

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
    const detail =
      res.status === 504
        ? "Suggest timed out — try again or use a shorter date range."
        : `Suggest failed (${res.status})`
    throw new Error(detail)
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

export async function ignoreCategorization(
  journalId: string,
  body: { transaction_journal_id: string },
): Promise<{ ok: boolean; journal_id: string }> {
  const res = await fetch(`/api/categorize/${journalId}/ignore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Ignore failed (${res.status})`)
  }
  return (await res.json()) as { ok: boolean; journal_id: string }
}

export async function previewRule(body: {
  start: string
  end: string
  rule: RuleDraft
}): Promise<{ data: RulePreviewCounts }> {
  const res = await fetch("/api/categorize/rules/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Rule preview failed (${res.status})`)
  }
  return (await res.json()) as { data: RulePreviewCounts }
}

export async function createRule(body: {
  start: string
  end: string
  category_id: string
  budget_id?: string | null
  rule: RuleDraft
}): Promise<{ data: { rule_id: string; title?: string } }> {
  const res = await fetch("/api/categorize/rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      detail?: string | { message?: string; existing_rules?: Array<{ title: string }> }
    }
    if (res.status === 409 && payload.detail && typeof payload.detail === "object") {
      const titles = payload.detail.existing_rules?.map((r) => r.title).join(", ")
      throw new Error(
        titles
          ? `Duplicate rule: ${titles}`
          : "A similar rule already exists.",
      )
    }
    throw new Error(apiErrorDetail(payload, `Rule create failed (${res.status})`))
  }
  return (await res.json()) as { data: { rule_id: string; title?: string } }
}

export async function triggerRule(
  ruleId: string,
  body: { start: string; end: string },
): Promise<{ ok: boolean; rule_id: string }> {
  const res = await fetch(`/api/categorize/rules/${ruleId}/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { detail?: unknown }
    throw new Error(apiErrorDetail(payload, `Rule trigger failed (${res.status})`))
  }
  return (await res.json()) as { ok: boolean; rule_id: string }
}
