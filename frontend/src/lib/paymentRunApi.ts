export type FundingBucketRollup = {
  id: string
  label: string
  sort_order: number
  reported_balance: string
  user_balance: string
  user_balance_override: boolean
  planned_outflows: string
  remaining: string
}

export type CreditCardRow = {
  account_id: string
  row_key: string
  name: string | null
  credit_limit: string | null
  funding_bucket_key: string | null
  owed: string
  new_total: string
  interest_accrued: string
  fees: string
  last_payment_date: string | null
  planned_amount: string
  planned_amount_override: boolean
  paid_at: string | null
}

export type PaymentWorksheetEnvelope = {
  month: string
  refreshed_at: string | null
  buckets: FundingBucketRollup[]
  credit_cards: CreditCardRow[]
  shortfall: boolean
  totals: {
    reported_balance: string
    user_balance: string
    remaining: string
  }
}

export type FundingBucket = {
  id: string
  label: string
  sort_order: number
  firefly_account_ids: string[]
}

export type FundingBucketInput = {
  id?: string
  label: string
  sort_order?: number
  firefly_account_ids: string[]
}

async function parseError(res: Response, fallback: string): Promise<never> {
  let detail = fallback
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

export function currentMonthKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-")
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

export async function fetchPaymentWorksheet(
  month: string,
): Promise<PaymentWorksheetEnvelope> {
  const params = new URLSearchParams({ month })
  const res = await fetch(`/api/payment-run?${params}`)
  if (!res.ok) {
    await parseError(res, `Failed to load payment worksheet (${res.status})`)
  }
  return (await res.json()) as PaymentWorksheetEnvelope
}

export async function refreshPaymentWorksheet(
  month: string,
): Promise<{ month: string; refreshed_at: string }> {
  const params = new URLSearchParams({ month })
  const res = await fetch(`/api/payment-run/refresh?${params}`, {
    method: "POST",
  })
  if (!res.ok) {
    await parseError(res, `Failed to refresh balances (${res.status})`)
  }
  return (await res.json()) as { month: string; refreshed_at: string }
}

export async function fetchFundingBuckets(): Promise<{ data: FundingBucket[] }> {
  const res = await fetch("/api/payment-run/buckets")
  if (!res.ok) {
    await parseError(res, `Failed to fetch funding buckets (${res.status})`)
  }
  return (await res.json()) as { data: FundingBucket[] }
}

export async function createFundingBucket(
  body: FundingBucketInput,
): Promise<FundingBucket> {
  const res = await fetch("/api/payment-run/buckets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await parseError(res, `Failed to create funding bucket (${res.status})`)
  }
  return (await res.json()) as FundingBucket
}

export async function updateFundingBucket(
  bucketId: string,
  body: FundingBucketInput,
): Promise<FundingBucket> {
  const res = await fetch(`/api/payment-run/buckets/${bucketId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await parseError(res, `Failed to update funding bucket (${res.status})`)
  }
  return (await res.json()) as FundingBucket
}

export async function deleteFundingBucket(bucketId: string): Promise<void> {
  const res = await fetch(`/api/payment-run/buckets/${bucketId}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    await parseError(res, `Failed to delete funding bucket (${res.status})`)
  }
}

export async function putBucketBalance(
  bucketId: string,
  month: string,
  body: { user_balance: string; reset_to_reported?: boolean },
): Promise<{
  bucket_key: string
  month: string
  user_balance: string
  user_balance_override: boolean
}> {
  const params = new URLSearchParams({ month })
  const res = await fetch(
    `/api/payment-run/buckets/${bucketId}/balance?${params}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    await parseError(res, `Failed to save bucket balance (${res.status})`)
  }
  return (await res.json()) as {
    bucket_key: string
    month: string
    user_balance: string
    user_balance_override: boolean
  }
}

export async function putRowState(
  rowKey: string,
  month: string,
  body: {
    planned_amount?: string
    paid_at?: string | null
    clear_paid?: boolean
  },
): Promise<{
  row_key: string
  month: string
  planned_amount: string
  paid_at: string | null
}> {
  const params = new URLSearchParams({ month })
  const res = await fetch(`/api/payment-run/rows/${rowKey}?${params}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await parseError(res, `Failed to save row state (${res.status})`)
  }
  return (await res.json()) as {
    row_key: string
    month: string
    planned_amount: string
    paid_at: string | null
  }
}

export async function putAccountWorksheet(
  accountId: string,
  body: {
    included?: boolean
    funding_bucket_key?: string | null
    credit_limit?: string | null
    default_planned_payment?: string | null
  },
): Promise<{ account_id: string; profile: Record<string, unknown> }> {
  const res = await fetch(`/api/payment-run/accounts/${accountId}/worksheet`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await parseError(res, `Failed to update account worksheet (${res.status})`)
  }
  return (await res.json()) as {
    account_id: string
    profile: Record<string, unknown>
  }
}
