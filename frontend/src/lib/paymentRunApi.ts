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

export type AmountDueRow = {
  row_key: string
  amount_due: string
  amount_due_override: boolean
  amount_mode?: string
  planned_amount?: string
  account_id?: string
}

export type BillRow = PlannedAmountRow &
  AmountDueRow & {
  registry_id: number
  row_label: string | null
  firefly_bill_id: string | null
  paid_at: string | null
  payment_rail: string
  counts_toward_cash_plan: boolean
  funding_bucket_key: string | null
  credit_card_account_id: string | null
  amount_mode: string
  worksheet_section: string
  bill_group_id?: string | null
  show_in_group?: boolean
}

export type LiabilityRow = PlannedAmountRow &
  AmountDueRow & {
  account_id?: string
  registry_id?: number
  name?: string | null
  row_label?: string | null
  firefly_bill_id?: string | null
  owed?: string
  paid_at: string | null
  est_interest: string | null
  remaining_payments: number | null
  funding_bucket_key: string | null
  default_planned_payment?: string | null
  payment_rail?: string
  counts_toward_cash_plan?: boolean
  credit_card_account_id?: string | null
  amount_mode?: string
  bill_group_id?: string | null
  show_in_group?: boolean
}

export type SectionSubtotals = {
  bills: {
    owed: string
    due: string
    planned_cash: string
    on_card_informational?: string
  }
  liabilities: {
    owed: string
    due: string
    planned_cash: string
  }
  credit_cards: {
    planned_cash: string
  }
}

export type DuePlannedRailSection = {
  cash: { due: string; planned: string }
  credit: { due: string; planned: string }
}

export type DuePlannedSection = DuePlannedRailSection & {
  by_credit_card?: CreditCardDuePlannedRow[]
}

export type CreditCardDuePlannedRow = {
  account_id: string | null
  name: string
  due: string
  planned: string
}

export type GrandTotalsBreakdown = {
  owed: {
    liabilities: string
    revolving: string
    real_estate?: string
    loans?: string
  }
  due: {
    cash: string
    credit: string
  }
  planned: {
    cash: string
    credit: string
  }
  due_planned: {
    liabilities: DuePlannedSection
    bills: DuePlannedSection
    credit_card_pmts: DuePlannedRailSection
  }
}

export type GrandTotals = {
  owed: string
  due: string
  planned_cash: string
  planned_total: string
  breakdown: GrandTotalsBreakdown
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

export type RegisteredBillListItem = {
  registry_id: number
  row_label: string | null
  firefly_bill_id: string
  worksheet_section: string
  payment_rail: string
  amount_mode: string
}

export type BillHistoryTransaction = {
  journal_id: string
  date: string
  description: string | null
  payee: string | null
  amount: string
}

export type RuleLinkSyncStatus =
  | "synced"
  | "out_of_sync"
  | "rule_unavailable"
  | "missing_link_action"

export type BillHistoryEnvelope = {
  registry_id: number
  row_label: string | null
  row_label_synced?: boolean
  name?: string | null
  firefly_bill_id: string
  firefly_base_url?: string
  rule_sync_status?: RuleLinkSyncStatus
  window: { start: string; end: string }
  total: string
  calendar_average: string
  active_month_average: string
  active_month_count: number
  monthly_totals: { month: string; total: string }[]
  transactions: BillHistoryTransaction[]
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

export type BillLinkRule = {
  id: string
  title: string | null
  description_contains: string | null
  payee_contains: string | null
  category_name: string | null
  amount_exactly: string | null
}

export type RegisterBillPayload = {
  mode: "create_new" | "link_existing"
  name: string
  amount?: string
  amount_min?: string
  amount_max?: string
  amount_mode: "recurring" | "intermittent"
  repeat_freq?: string | null
  worksheet_section: "bills" | "liabilities"
  payment_rail: "bank" | "credit_card"
  funding_bucket_key?: string | null
  credit_card_account_id?: string | null
  description_contains: string
  destination_account?: string
  category_name?: string
  amount_exactly?: string | null
  firefly_bill_id?: string | null
  rule_id?: string | null
  bill_group_id?: string | null
  show_in_group?: boolean
}

export type UpdateBillRegistryPayload = {
  worksheet_section?: "bills" | "liabilities"
  payment_rail?: "bank" | "credit_card"
  funding_bucket_key?: string | null
  credit_card_account_id?: string | null
  row_label?: string | null
  amount_mode?: "recurring" | "intermittent"
  name?: string
  amount_min?: string
  amount_max?: string
  repeat_freq?: string | null
  bill_group_id?: string | null
  show_in_group?: boolean
}

export type BillRegistryEditDetails = {
  registry_id: number
  row_label: string | null
  firefly_bill_id: string | null
  worksheet_section: string
  payment_rail: string
  amount_mode: string
  funding_bucket_key: string | null
  credit_card_account_id: string | null
  name: string | null
  amount_min: string | null
  amount_max: string | null
  repeat_freq: string | null
  bill_group_id?: string | null
  show_in_group?: boolean
  rule_sync_status?: RuleLinkSyncStatus
}

export type CreditCardRow = PlannedAmountRow & {
  account_id: string
  name: string | null
  credit_limit: string | null
  funding_bucket_key: string | null
  default_planned_payment: string | null
  payment_due_day: string | null
  apr_percent: string | null
  sort_order?: number | null
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

export type WorksheetBillGroupSummary = {
  id: string
  label: string
  sort_order: number
  member_count: number
  visible_count: number
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
  bill_groups: WorksheetBillGroupSummary[]
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

export type BillGroupMember = {
  registry_id: number
  row_label: string | null
  show_in_group: boolean
}

export type BillGroup = {
  id: string
  label: string
  sort_order: number
  member_count: number
  visible_count: number
  members: BillGroupMember[]
}

export type BillGroupCreateInput = {
  label: string
  sort_order?: number
}

export type BillGroupPatchInput = {
  label?: string
  sort_order?: number
  member_ids?: number[]
}

export type BillRegistrationPrefill = {
  mode?: "create_new" | "link_existing"
  name?: string
  amount_min?: string
  amount_max?: string
  amount_mode?: "recurring" | "intermittent"
  repeat_freq?: string | null
  worksheet_section?: "bills" | "liabilities"
  payment_rail?: "bank" | "credit_card"
  destination_account?: string
  category_name?: string
  description_contains?: string
  amount_exactly?: string | null
}

export type BillSuggestion = {
  id: string
  merchant: string
  confidence: "high" | "medium" | "low"
  status: "ready" | "review"
  amount_min: string
  amount_max: string
  amount_avg: string
  occurrences: number
  freq: string
  regularity: number
  last_date: string
  first_date: string
  category: string
  payment_source: string
  sample_descriptions: string[]
  payee: string
  destination_name?: string | null
  bucket: string
  cluster: string | null
  register_prefill: BillRegistrationPrefill
  reasons: string[]
  notes?: string
}

export type BillSuggestionsEnvelope = {
  data: BillSuggestion[]
  meta: {
    withdrawals_analyzed: number
    suggestions_count: number
    period_start: string
    period_end: string
  }
}

export type BillSuggestionTransaction = {
  date: string
  amount: string
  description: string
  category: string | null
  payee: string | null
  budget: string | null
}

export type BillSuggestionTransactionsEnvelope = {
  data: BillSuggestionTransaction[]
  meta: {
    suggestion_id: string
    transaction_count: number
    period_start: string
    period_end: string
  }
}

export type DiscoverCategoryOption = {
  id: string
  name: string
}

export type DiscoverSettingsEnvelope = {
  ignored_categories: string[]
  ignored_payees: string[]
  available_categories: DiscoverCategoryOption[]
  suggested_ignored_categories?: string[]
}

export type DiscoverSettingsUpdate = {
  ignored_categories?: string[]
  ignored_payees?: string[]
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

export function billGroupsQueryKey() {
  return ["paymentRun", "billGroups"] as const
}

export async function fetchBillGroups(): Promise<{ data: BillGroup[] }> {
  const res = await fetch("/api/payment-run/bill-groups")
  if (!res.ok) {
    await parseError(res, `Failed to fetch bill groups (${res.status})`)
  }
  return (await res.json()) as { data: BillGroup[] }
}

export async function createBillGroup(
  body: BillGroupCreateInput,
): Promise<BillGroup> {
  const res = await fetch("/api/payment-run/bill-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await parseError(res, `Failed to create bill group (${res.status})`)
  }
  return (await res.json()) as BillGroup
}

export async function patchBillGroup(
  groupId: string,
  body: BillGroupPatchInput,
): Promise<BillGroup> {
  const res = await fetch(`/api/payment-run/bill-groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await parseError(res, `Failed to update bill group (${res.status})`)
  }
  return (await res.json()) as BillGroup
}

export async function deleteBillGroup(groupId: string): Promise<void> {
  const res = await fetch(`/api/payment-run/bill-groups/${groupId}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    await parseError(res, `Failed to delete bill group (${res.status})`)
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
    amount_due?: string
    paid_at?: string | null
    clear_paid?: boolean
    clear_planned_override?: boolean
    clear_amount_due_override?: boolean
  },
): Promise<{
  row_key: string
  month: string
  planned_amount: string
  amount_due: string
  amount_due_override: boolean
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
    amount_due: string
    amount_due_override: boolean
    paid_at: string | null
  }
}

export async function fetchBillLinkRules(
  billId: string,
): Promise<{ data: BillLinkRule[] }> {
  const res = await fetch(
    `/api/payment-run/bills/${encodeURIComponent(billId)}/link-rules`,
  )
  if (!res.ok) {
    await parseError(res, `Failed to fetch bill link rules (${res.status})`)
  }
  return (await res.json()) as { data: BillLinkRule[] }
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

export async function fetchRegisteredBills(): Promise<{
  data: RegisteredBillListItem[]
}> {
  const res = await fetch("/api/payment-run/bills")
  if (!res.ok) {
    await parseError(res, `Failed to fetch registered bills (${res.status})`)
  }
  return (await res.json()) as { data: RegisteredBillListItem[] }
}

export async function fetchBillHistory(
  registryId: number,
): Promise<BillHistoryEnvelope> {
  const res = await fetch(`/api/payment-run/bills/${registryId}/history`)
  if (!res.ok) {
    await parseError(res, `Failed to fetch bill history (${res.status})`)
  }
  return (await res.json()) as BillHistoryEnvelope
}

export async function fetchBillSuggestions(
  lookbackMonths: number,
): Promise<BillSuggestionsEnvelope> {
  const params = new URLSearchParams({
    lookback_months: String(lookbackMonths),
  })
  const res = await fetch(`/api/payment-run/bill-suggestions?${params}`)
  if (!res.ok) {
    await parseError(res, `Failed to load bill suggestions (${res.status})`)
  }
  return (await res.json()) as BillSuggestionsEnvelope
}

export async function fetchBillSuggestionTransactions(
  suggestionId: string,
  lookbackMonths: number,
): Promise<BillSuggestionTransactionsEnvelope> {
  const params = new URLSearchParams({
    lookback_months: String(lookbackMonths),
  })
  const res = await fetch(
    `/api/payment-run/bill-suggestions/${encodeURIComponent(suggestionId)}/transactions?${params}`,
  )
  if (!res.ok) {
    await parseError(
      res,
      `Failed to load suggestion transactions (${res.status})`,
    )
  }
  return (await res.json()) as BillSuggestionTransactionsEnvelope
}

export async function fetchDiscoverSettings(): Promise<DiscoverSettingsEnvelope> {
  const res = await fetch("/api/payment-run/discover-settings")
  if (!res.ok) {
    await parseError(res, `Failed to load discover settings (${res.status})`)
  }
  return (await res.json()) as DiscoverSettingsEnvelope
}

export async function updateDiscoverSettings(
  body: DiscoverSettingsUpdate,
): Promise<Pick<DiscoverSettingsEnvelope, "ignored_categories" | "ignored_payees">> {
  const res = await fetch("/api/payment-run/discover-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await parseError(res, `Failed to save discover settings (${res.status})`)
  }
  return (await res.json()) as Pick<
    DiscoverSettingsEnvelope,
    "ignored_categories" | "ignored_payees"
  >
}

export async function ignoreDiscoverPayee(
  suggestionId: string,
  lookbackMonths: number,
): Promise<{ ignored_payees: string[]; ignored_payee: string }> {
  const res = await fetch("/api/payment-run/discover-settings/ignore-payee", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      suggestion_id: suggestionId,
      lookback_months: lookbackMonths,
    }),
  })
  if (!res.ok) {
    await parseError(res, `Failed to ignore payee (${res.status})`)
  }
  return (await res.json()) as { ignored_payees: string[]; ignored_payee: string }
}

export async function ignoreDiscoverCategory(
  category: string,
): Promise<{ ignored_categories: string[]; ignored_category: string }> {
  const res = await fetch("/api/payment-run/discover-settings/ignore-category", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category }),
  })
  if (!res.ok) {
    await parseError(res, `Failed to ignore category (${res.status})`)
  }
  return (await res.json()) as {
    ignored_categories: string[]
    ignored_category: string
  }
}

type BillRegistrationErrorDetail = {
  message?: string
  conflicting_rule_id?: string
  firefly_rule_url?: string
  conflicting_bill_id?: string
  firefly_bill_url?: string
}

export class BillRegistrationApiError extends Error {
  readonly conflictingRuleId?: string
  readonly fireflyRuleUrl?: string
  readonly conflictingBillId?: string
  readonly fireflyBillUrl?: string

  constructor(message: string, extras: BillRegistrationErrorDetail = {}) {
    super(message)
    this.name = "BillRegistrationApiError"
    this.conflictingRuleId = extras.conflicting_rule_id
    this.fireflyRuleUrl = extras.firefly_rule_url
    this.conflictingBillId = extras.conflicting_bill_id
    this.fireflyBillUrl = extras.firefly_bill_url
  }
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
    const payload = (await res.json().catch(() => ({}))) as {
      detail?: string | BillRegistrationErrorDetail
    }
    const { detail } = payload
    if (detail && typeof detail === "object" && typeof detail.message === "string") {
      throw new BillRegistrationApiError(detail.message, detail)
    }
    if (typeof detail === "string" && detail.trim()) {
      throw new BillRegistrationApiError(detail)
    }
    throw new BillRegistrationApiError(
      `Failed to register bill (${res.status})`,
    )
  }
  return (await res.json()) as BillRegistryRow
}

export async function fetchBillRegistry(
  registryId: number,
): Promise<BillRegistryEditDetails> {
  const res = await fetch(`/api/payment-run/bills/${registryId}`)
  if (!res.ok) {
    await parseError(res, `Failed to load bill registration (${res.status})`)
  }
  return (await res.json()) as BillRegistryEditDetails
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

export async function repairBillLinkRule(
  registryId: number,
): Promise<{ ok: boolean; rule_sync_status: RuleLinkSyncStatus }> {
  const res = await fetch(
    `/api/payment-run/bills/${registryId}/repair-rule`,
    { method: "POST" },
  )
  if (!res.ok) {
    await parseError(res, `Failed to repair import rule (${res.status})`)
  }
  return (await res.json()) as { ok: boolean; rule_sync_status: RuleLinkSyncStatus }
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
    sort_order?: number | null
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
