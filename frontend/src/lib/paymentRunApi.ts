export type FundingBucketRollup = {
  id: string
  label: string
  sort_order: number
  firefly_account_ids?: string[]
  reported_balance: string
  user_balance: string
  user_balance_override: boolean
  planned_outflows: string
  remaining: string
}

export type CreditCardActivityTransaction = {
  journal_id: string | null
  date: string
  description: string
  payee: string | null
  category: string | null
  budget: string | null
  kind: "charge" | "interest" | "fee"
  amount: string
}

export type PlannedAmountRow = {
  row_key: string
  planned_amount: string
  planned_amount_override: boolean
}

export type BillRow = PlannedAmountRow & {
  registry_id: number
  row_label: string | null
  firefly_bill_id: string | null
  owed: string
  paid_at: string | null
  payment_rail: string
  counts_toward_cash_plan: boolean
  funding_bucket_key: string | null
  credit_card_account_id: string | null
  amount_mode: string
  worksheet_section: string
}

export type LiabilityRow = PlannedAmountRow & {
  account_id?: string
  registry_id?: number
  name?: string | null
  row_label?: string | null
  owed: string
  paid_at: string | null
  est_interest: string | null
  remaining_payments: number | null
  funding_bucket_key: string | null
  default_planned_payment?: string | null
  payment_rail?: string
  counts_toward_cash_plan?: boolean
  credit_card_account_id?: string | null
  amount_mode?: string
}

export type SectionSubtotals = {
  bills: {
    owed: string
    planned_cash: string
    on_card_informational?: string
  }
  liabilities: {
    owed: string
    planned_cash: string
  }
  credit_cards: {
    planned_cash: string
  }
}

export type GrandTotals = {
  owed: string
  planned_cash: string
}

export type ExcludedLiability = {
  account_id: string
  name: string | null
}

export type AvailableFireflyBill = {
  id: string
  name: string | null
  amount_min?: string | null
  amount_max?: string | null
  repeat_freq?: string | null
}

export type BillRegistryRow = {
  id: number
  firefly_bill_id: string | null
  worksheet_section: string
  funding_bucket_key: string | null
  amount_mode: string
  planned_sync: string
  payment_rail: string
  counts_toward_cash_plan: boolean
  rule_id: string | null
  row_label: string | null
  credit_card_account_id: string | null
}

export type RegisterBillPayload = {
  mode: "create_new" | "link_existing"
  name: string
  amount: string
  amount_mode: "recurring" | "intermittent"
  repeat_freq?: string | null
  worksheet_section: "bills" | "liabilities"
  payment_rail: "bank" | "credit_card"
  funding_bucket_key?: string | null
  credit_card_account_id?: string | null
  description_contains: string
  amount_exactly?: string | null
  firefly_bill_id?: string | null
  rule_id?: string | null
}

export type UpdateBillRegistryPayload = {
  worksheet_section?: "bills" | "liabilities"
  payment_rail?: "bank" | "credit_card"
  funding_bucket_key?: string | null
  credit_card_account_id?: string | null
  row_label?: string | null
  amount_mode?: "recurring" | "intermittent"
}

export type CreditCardRow = PlannedAmountRow & {
  account_id: string
  name: string | null
  credit_limit: string | null
  funding_bucket_key: string | null
  default_planned_payment: string | null
  payment_due_day: string | null
  apr_percent: string | null
  owed: string
  new_total: string
  interest_accrued: string
  fees: string
  last_payment_date: string | null
  last_payment_amount: string
  new_transactions: CreditCardActivityTransaction[]
  planned_amount: string
  planned_amount_override: boolean
  paid_at: string | null
}

export type ExcludedCreditCard = {
  account_id: string
  name: string | null
}

export type PaymentWorksheetEnvelope = {
  month: string
  refreshed_at: string | null
  buckets: FundingBucketRollup[]
  credit_cards: CreditCardRow[]
  excluded_credit_cards: ExcludedCreditCard[]
  bills: BillRow[]
  liabilities: LiabilityRow[]
  excluded_liabilities: ExcludedLiability[]
  section_subtotals: SectionSubtotals
  grand_totals: GrandTotals
  shortfall: boolean
  firefly_base_url?: string
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
    clear_planned_override?: boolean
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

export async function fetchAvailableBills(): Promise<{
  data: AvailableFireflyBill[]
}> {
  const res = await fetch("/api/payment-run/available")
  if (!res.ok) {
    await parseError(res, `Failed to fetch available bills (${res.status})`)
  }
  return (await res.json()) as { data: AvailableFireflyBill[] }
}

export async function registerBill(
  body: RegisterBillPayload,
): Promise<BillRegistryRow> {
  const res = await fetch("/api/payment-run/bills/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await parseError(res, `Failed to register bill (${res.status})`)
  }
  return (await res.json()) as BillRegistryRow
}

export async function updateBillRegistry(
  registryId: number,
  body: UpdateBillRegistryPayload,
): Promise<BillRegistryRow> {
  const res = await fetch(`/api/payment-run/bills/${registryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await parseError(res, `Failed to update bill registration (${res.status})`)
  }
  return (await res.json()) as BillRegistryRow
}

export async function deleteBillRegistry(registryId: number): Promise<void> {
  const res = await fetch(`/api/payment-run/bills/${registryId}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    await parseError(res, `Failed to remove bill registration (${res.status})`)
  }
}

export async function putAccountWorksheet(
  accountId: string,
  month: string,
  body: {
    included?: boolean
    funding_bucket_key?: string | null
    credit_limit?: string | null
    default_planned_payment?: string | null
    payment_due_day?: string | null
    apr_percent?: string | null
  },
): Promise<{ account_id: string; profile: Record<string, unknown> }> {
  const params = new URLSearchParams({ month })
  const res = await fetch(
    `/api/payment-run/accounts/${accountId}/worksheet?${params}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    await parseError(res, `Failed to update account worksheet (${res.status})`)
  }
  return (await res.json()) as {
    account_id: string
    profile: Record<string, unknown>
  }
}
