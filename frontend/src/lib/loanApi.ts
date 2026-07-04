export type LoanAccountOption = {
  id: string
  name: string
  type?: string | null
  role?: string | null
}

export type LoanMeta = {
  liability_accounts: LoanAccountOption[]
  expense_accounts: LoanAccountOption[]
  asset_accounts: LoanAccountOption[]
  categories: LoanAccountOption[]
  budgets: LoanAccountOption[]
}

export type LoanAccountRow = {
  account_id: string
  name: string
  profile: LoanProfile | null
  enabled: boolean
  configured: boolean
}

export type LoanProfile = {
  version: number
  enabled: boolean
  match: {
    type?: "transfer" | "withdrawal"
    description_contains: string
    expected_amount: string
    amount_tolerance?: string
    source_account_id?: string | null
    import_destination_account_id?: string | null
    max_per_month?: number | null
  }
  split: {
    escrow_amount: string
    budget?: string | null
    components: Array<{
      role: "principal" | "interest" | "escrow"
      type: "transfer" | "withdrawal"
      destination_account_id: string
      destination_account: string
      category?: string | null
      budget?: string | null
    }>
  }
  rate_override?: string | null
  notes?: string | null
}

export type LoanDetail = {
  account_id: string
  name: string
  current_balance?: string
  interest?: string
  profile: LoanProfile | null
  enabled: boolean
}

export type SplitAmounts = {
  principal: string
  interest: string
  escrow: string
}

export type PendingLoanSplit = {
  journal_id: string
  transaction_journal_id: string
  description: string
  amount: string
  date: string
  profile_account_id: string
  preview: SplitAmounts
  warning: boolean
}

export type PendingLoanSplitsResponse = {
  data: PendingLoanSplit[]
  meta: {
    count: number
    start: string
    end: string
    forward_only_since: string
  }
}

export async function fetchLoans(): Promise<{ data: LoanAccountRow[] }> {
  const res = await fetch("/api/loans")
  if (!res.ok) throw new Error(`Failed to fetch loans (${res.status})`)
  return (await res.json()) as { data: LoanAccountRow[] }
}

export async function fetchLoanMeta(): Promise<LoanMeta> {
  const res = await fetch("/api/loans/meta")
  if (!res.ok) throw new Error(`Failed to fetch loan meta (${res.status})`)
  return (await res.json()) as LoanMeta
}

export async function fetchLoan(accountId: string): Promise<LoanDetail> {
  const res = await fetch(`/api/loans/${accountId}`)
  if (!res.ok) throw new Error(`Failed to fetch loan (${res.status})`)
  return (await res.json()) as LoanDetail
}

export async function saveLoanProfile(
  accountId: string,
  profile: LoanProfile,
): Promise<{ ok: boolean; profile: LoanProfile }> {
  const { rate_override: _omit, ...payload } = profile
  const res = await fetch(`/api/loans/${accountId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Failed to save loan profile (${res.status})`)
  return (await res.json()) as { ok: boolean; profile: LoanProfile }
}

export async function fetchPendingLoanSplits(
  start: string,
  end: string,
): Promise<PendingLoanSplitsResponse> {
  const params = new URLSearchParams({ start, end })
  const res = await fetch(`/api/loan-splits/pending?${params}`)
  if (!res.ok) throw new Error(`Failed to fetch loan splits (${res.status})`)
  return (await res.json()) as PendingLoanSplitsResponse
}

export async function applyLoanSplit(
  groupId: string,
  body: {
    transaction_journal_id: string
    principal: string
    interest: string
    escrow: string
    start: string
    end: string
  },
): Promise<{ ok: boolean; journal_id: string }> {
  const res = await fetch(`/api/loan-splits/${groupId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = `Apply loan split failed (${res.status})`
    try {
      const json = (await res.json()) as { detail?: string }
      if (typeof json.detail === "string" && json.detail.trim()) {
        detail = json.detail
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(detail)
  }
  return (await res.json()) as { ok: boolean; journal_id: string }
}

export async function previewLoanSplit(
  groupId: string,
  start: string,
  end: string,
  overrides: Partial<SplitAmounts>,
): Promise<{ amounts: SplitAmounts; warnings: boolean[] }> {
  const params = new URLSearchParams({ start, end })
  const res = await fetch(`/api/loan-splits/${groupId}/preview?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides),
  })
  if (!res.ok) throw new Error(`Preview loan split failed (${res.status})`)
  return (await res.json()) as { amounts: SplitAmounts; warnings: boolean[] }
}
