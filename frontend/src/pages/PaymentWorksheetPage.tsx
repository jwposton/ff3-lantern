import { useEffect, useMemo, useState } from "react"
import { Navigate, useSearchParams } from "react-router-dom"
import { CircleHelp, RefreshCw, Settings2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { BillRegistrationSheet, type BillRegistrationEditTarget } from "@/components/payment-run/BillRegistrationSheet"
import { BillsTable, countPaidRows } from "@/components/payment-run/BillsTable"
import { BucketSheet } from "@/components/payment-run/BucketSheet"
import { CreditCardSheet } from "@/components/payment-run/CreditCardSheet"
import type { CreditCardDetailsInput } from "@/components/payment-run/CreditCardSheet"
import { CreditCardsTable } from "@/components/payment-run/CreditCardsTable"
import { LiabilitiesTable } from "@/components/payment-run/LiabilitiesTable"
import {
  LiabilityAccountSheet,
  type LiabilityAccountDetailsInput,
} from "@/components/payment-run/LiabilityAccountSheet"
import { ManageCardsSheet } from "@/components/payment-run/ManageCardsSheet"
import { ManageLiabilitiesSheet } from "@/components/payment-run/ManageLiabilitiesSheet"
import {
  PaymentConfigureSheet,
  type ConfigureSection,
} from "@/components/payment-run/PaymentConfigureSheet"
import type { RegisteredBillRow } from "@/components/payment-run/paymentConfigureUtils"
import { FundingBucketBar } from "@/components/payment-run/FundingBucketBar"
import { ShortfallBanner } from "@/components/payment-run/ShortfallBanner"
import { WorksheetGrandTotal } from "@/components/payment-run/WorksheetGrandTotal"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useHealth } from "@/hooks/useHealth"
import { useLoanMeta, useLoans } from "@/hooks/useLoans"
import { isFundingBucketAsset } from "@/lib/accounts"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import {
  createFundingBucket,
  currentMonthKey,
  deleteBillRegistry,
  deleteFundingBucket,
  fetchAvailableBills,
  fetchFundingBuckets,
  formatMonthLabel,
  putBucketBalance,
  putRowState,
  putAccountWorksheet,
  refreshPaymentWorksheet,
  registerBill,
  updateBillRegistry,
  updateFundingBucket,
  type AvailableFireflyBill,
  type BillRow,
  type FundingBucket,
  type FundingBucketRollup,
  type CreditCardRow,
  type LiabilityRow,
  type RegisterBillPayload,
} from "@/lib/paymentRunApi"

function formatRefreshedAt(value: string | null | undefined): string {
  if (!value) return "Not refreshed this month"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `Last refreshed ${date.toLocaleString()}`
}

export function PaymentWorksheetPage() {
  const month = currentMonthKey()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { data: health, isPending: healthPending } = useHealth()
  const { data, isPending, isError, refetch } = usePaymentWorksheet(month)
  const { data: loanMeta } = useLoanMeta()
  const { data: loansData } = useLoans()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [ccActionError, setCcActionError] = useState<string | null>(null)
  const [bucketSheetOpen, setBucketSheetOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<FundingBucket | null>(null)
  const [cardSheetOpen, setCardSheetOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<CreditCardRow | null>(null)
  const [liabilitySheetOpen, setLiabilitySheetOpen] = useState(false)
  const [editingLiability, setEditingLiability] = useState<LiabilityRow | null>(
    null,
  )
  const [configureOpen, setConfigureOpen] = useState(false)
  const [configureSection, setConfigureSection] =
    useState<ConfigureSection>("bills")
  const [manageCardsOpen, setManageCardsOpen] = useState(false)
  const [manageLiabilitiesOpen, setManageLiabilitiesOpen] = useState(false)
  const [billRegistrationOpen, setBillRegistrationOpen] = useState(false)
  const [billRegistrationMode, setBillRegistrationMode] = useState<
    "create_new" | "link_existing"
  >("create_new")
  const [linkBillId, setLinkBillId] = useState<string | null>(null)
  const [billRegistrationSection, setBillRegistrationSection] = useState<
    "bills" | "liabilities"
  >("bills")
  const [billEditTarget, setBillEditTarget] =
    useState<BillRegistrationEditTarget | null>(null)
  const [availableBills, setAvailableBills] = useState<AvailableFireflyBill[]>(
    [],
  )
  const [loadingAvailableBills, setLoadingAvailableBills] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<RegisteredBillRow | null>(
    null,
  )
  const [removingBill, setRemovingBill] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const bucketAssetAccounts = useMemo(
    () =>
      (loanMeta?.asset_accounts ?? []).filter((account) =>
        isFundingBucketAsset(account.type, account.role),
      ),
    [loanMeta],
  )

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const account of loanMeta?.asset_accounts ?? []) {
      map.set(account.id, account.name)
    }
    return map
  }, [loanMeta])

  const ccGuidance = useMemo(() => {
    if (!data) return null
    if (data.credit_cards.length === 0) {
      if (!data.refreshed_at) {
        return (
          "Credit cards load from Firefly when you click Refresh balances — " +
          "there is no separate add step. Use Refresh after adding buckets."
        )
      }
      return (
        "No credit card asset accounts found in Firefly for this worksheet. " +
        "Confirm cards use the credit card account role, then refresh again."
      )
    }
    const unassigned = data.credit_cards.some(
      (row) => !row.funding_bucket_key,
    )
    if (unassigned) {
      return "Map cards to funding buckets to see planned outflows"
    }
    return null
  }, [data])

  useEffect(() => {
    if (searchParams.get("configure") !== "1") return
    setConfigureOpen(true)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  const loanByAccountId = useMemo(() => {
    const map = new Map<
      string,
      { configured: boolean; expectedAmount: string | null }
    >()
    for (const loan of loansData?.data ?? []) {
      map.set(loan.account_id, {
        configured: loan.configured,
        expectedAmount: loan.profile?.match.expected_amount ?? null,
      })
    }
    return map
  }, [loansData])

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  async function handleRefresh() {
    setRefreshing(true)
    setRefreshError(null)
    try {
      await refreshPaymentWorksheet(month)
      await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
    } catch (err) {
      setRefreshError(
        err instanceof Error
          ? err.message
          : "Could not refresh balances. Check Firefly connection and try again.",
      )
    } finally {
      setRefreshing(false)
    }
  }

  async function handleBalanceBlur(
    bucketId: string,
    body: { user_balance: string; reset_to_reported?: boolean },
  ) {
    await putBucketBalance(bucketId, month, body)
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handleResetBalance(bucketId: string) {
    await putBucketBalance(bucketId, month, {
      user_balance: "0",
      reset_to_reported: true,
    })
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handleSaveBucket(values: {
    id?: string
    label: string
    sort_order: number
    firefly_account_ids: string[]
  }) {
    if (values.id) {
      await updateFundingBucket(values.id, values)
    } else {
      await createFundingBucket(values)
    }
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handleDeleteBucket(bucketId: string) {
    await deleteFundingBucket(bucketId)
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  function openAddBucket() {
    setEditingBucket(null)
    setBucketSheetOpen(true)
  }

  async function openEditBucket(bucket: FundingBucketRollup) {
    const { data } = await fetchFundingBuckets()
    const full = data.find((row) => row.id === bucket.id) ?? null
    setEditingBucket(full)
    setBucketSheetOpen(true)
  }

  async function handlePlannedBlur(
    rowKey: string,
    body: { planned_amount: string; clear_planned_override?: boolean },
  ) {
    await putRowState(rowKey, month, body)
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handleAmountDueBlur(
    rowKey: string,
    body: { amount_due: string; clear_amount_due_override?: boolean },
  ) {
    await putRowState(rowKey, month, body)
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handlePaidChange(
    rowKey: string,
    paid: boolean,
  ) {
    if (paid) {
      await putRowState(rowKey, month, {
        paid_at: new Date().toISOString(),
      })
    } else {
      await putRowState(rowKey, month, { clear_paid: true })
    }
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handleCardPaidChange(row: CreditCardRow, paid: boolean) {
    await handlePaidChange(row.row_key, paid)
  }

  async function handleBillPaidChange(row: BillRow, paid: boolean) {
    await handlePaidChange(row.row_key, paid)
  }

  async function handleLiabilityPaidChange(row: LiabilityRow, paid: boolean) {
    await handlePaidChange(row.row_key, paid)
  }

  async function handleCardDetailsSave(
    accountId: string,
    values: CreditCardDetailsInput,
  ) {
    setCcActionError(null)
    try {
      await putAccountWorksheet(accountId, month, values)
      await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
    } catch (err) {
      setCcActionError(
        err instanceof Error ? err.message : "Could not save card details.",
      )
      throw err
    }
  }

  function openCardDetails(row: CreditCardRow) {
    setEditingCard(row)
    setCardSheetOpen(true)
  }

  async function handleExclude(row: CreditCardRow) {
    setCcActionError(null)
    try {
      await putAccountWorksheet(row.account_id, month, { included: false })
      await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
    } catch (err) {
      setCcActionError(
        err instanceof Error ? err.message : "Could not exclude card.",
      )
    }
  }

  async function handleIncludeCard(accountId: string) {
    setCcActionError(null)
    try {
      await putAccountWorksheet(accountId, month, { included: true })
      await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not restore card."
      setCcActionError(message)
      throw new Error(message)
    }
  }

  async function handleIncludeLiability(accountId: string) {
    await putAccountWorksheet(accountId, month, { included: true })
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handleLiabilityAccountSave(
    accountId: string,
    values: LiabilityAccountDetailsInput,
  ) {
    await putAccountWorksheet(accountId, month, values)
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handleExcludeLiability(row: LiabilityRow) {
    if (!row.account_id) return
    await putAccountWorksheet(row.account_id, month, { included: false })
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  function openLiabilityAccount(row: LiabilityRow) {
    setEditingLiability(row)
    setLiabilitySheetOpen(true)
  }

  function openConfigure(section: ConfigureSection = "bills") {
    setConfigureSection(section)
    setConfigureOpen(true)
  }

  async function openBillRegistration(section: "bills" | "liabilities") {
    setBillEditTarget(null)
    setBillRegistrationMode("create_new")
    setLinkBillId(null)
    setBillRegistrationSection(section)
    setBillRegistrationOpen(true)
    setLoadingAvailableBills(true)
    try {
      const { data: bills } = await fetchAvailableBills()
      setAvailableBills(bills)
    } catch {
      setAvailableBills([])
    } finally {
      setLoadingAvailableBills(false)
    }
  }

  function openRegisterBillFromConfigure() {
    setConfigureOpen(false)
    void openBillRegistration("bills")
  }

  function openEditBillFromConfigure(row: RegisteredBillRow) {
    setConfigureOpen(false)
    setBillEditTarget({
      registryId: row.registry_id,
      row_label: row.name,
      worksheet_section: row.worksheet_section,
      payment_rail: row.payment_rail,
      funding_bucket_key: row.funding_bucket_key,
      credit_card_account_id: row.credit_card_account_id,
      amount_mode: row.amount_mode,
    })
    setBillRegistrationSection(
      row.worksheet_section === "liabilities" ? "liabilities" : "bills",
    )
    setBillRegistrationMode("create_new")
    setLinkBillId(null)
    setBillRegistrationOpen(true)
  }

  function openLinkBillFromConfigure(fireflyBillId: string) {
    setConfigureOpen(false)
    setBillEditTarget(null)
    setBillRegistrationMode("link_existing")
    setLinkBillId(fireflyBillId)
    setBillRegistrationSection("bills")
    setBillRegistrationOpen(true)
    void fetchAvailableBills()
      .then(({ data: bills }) => setAvailableBills(bills))
      .catch(() => setAvailableBills([]))
  }

  function openEditCardFromConfigure(row: CreditCardRow) {
    setConfigureOpen(false)
    openCardDetails(row)
  }

  function openEditLiabilityFromConfigure(row: LiabilityRow) {
    setConfigureOpen(false)
    openLiabilityAccount(row)
  }

  function openManageExcludedCardsFromConfigure() {
    setConfigureOpen(false)
    setManageCardsOpen(true)
  }

  function openManageExcludedLiabilitiesFromConfigure() {
    setConfigureOpen(false)
    setManageLiabilitiesOpen(true)
  }

  async function handleConfirmRemoveBill() {
    if (!removeTarget) return
    setRemovingBill(true)
    setRemoveError(null)
    try {
      await deleteBillRegistry(removeTarget.registry_id)
      setRemoveTarget(null)
      await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
      await queryClient.invalidateQueries({
        queryKey: ["paymentRun", "availableBills"],
      })
    } catch (err) {
      setRemoveError(
        err instanceof Error
          ? err.message
          : "Could not remove bill registration. Try again.",
      )
    } finally {
      setRemovingBill(false)
    }
  }

  function openEditBillRegistration(row: BillRow | LiabilityRow) {
    if (!row.registry_id) return
    const name =
      row.row_label ??
      ("name" in row ? row.name : null) ??
      `Bill ${row.registry_id}`
    const worksheetSection =
      "worksheet_section" in row && row.worksheet_section
        ? row.worksheet_section
        : "bills"
    setBillEditTarget({
      registryId: row.registry_id,
      row_label: name,
      worksheet_section: worksheetSection,
      payment_rail: row.payment_rail ?? "bank",
      funding_bucket_key: row.funding_bucket_key ?? null,
      credit_card_account_id: row.credit_card_account_id ?? null,
      amount_mode: row.amount_mode ?? "recurring",
    })
    setBillRegistrationSection(
      worksheetSection === "liabilities" ? "liabilities" : "bills",
    )
    setBillRegistrationMode("create_new")
    setLinkBillId(null)
    setBillRegistrationOpen(true)
  }

  async function handleRegisterBill(payload: RegisterBillPayload) {
    if (billEditTarget) {
      await updateBillRegistry(billEditTarget.registryId, {
        worksheet_section: payload.worksheet_section,
        payment_rail: payload.payment_rail,
        funding_bucket_key: payload.funding_bucket_key,
        credit_card_account_id: payload.credit_card_account_id,
        row_label: payload.name,
        amount_mode: payload.amount_mode,
      })
    } else {
      await registerBill(payload)
    }
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  const paidCount = data?.credit_cards.filter((row) => row.paid_at).length ?? 0
  const ccCount = data?.credit_cards.length ?? 0
  const excludedCount = data?.excluded_credit_cards.length ?? 0
  const billsPaidCount = data ? countPaidRows(data.bills) : 0
  const billsTotalCount = data?.bills.length ?? 0
  const liabilitiesPaidCount = data ? countPaidRows(data.liabilities) : 0
  const liabilitiesTotalCount = data?.liabilities.length ?? 0
  const excludedLiabilitiesCount = data?.excluded_liabilities.length ?? 0

  return (
    <div className="-m-6 flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-4 px-6 pt-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Payment Worksheet
            </h1>
            <p className="text-muted-foreground text-sm">
              Plan credit cards, bills, and liabilities for{" "}
              {formatMonthLabel(month)} — balances from Firefly on Refresh.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span className="text-muted-foreground text-sm">
              {formatRefreshedAt(data?.refreshed_at)}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openConfigure()}
              >
                <Settings2 className="mr-2 size-4" />
                Configure worksheet
              </Button>
              <Button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || isPending}
              >
                <RefreshCw
                  className={
                    refreshing ? "mr-2 size-4 animate-spin" : "mr-2 size-4"
                  }
                />
                {refreshing ? "Refreshing…" : "Refresh balances"}
              </Button>
            </div>
          </div>
        </div>

        {refreshError ? (
          <p className="text-destructive text-sm">{refreshError}</p>
        ) : null}

        {isPending || healthPending ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : null}

        {isError ? (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <p className="text-destructive text-sm">
                Could not load payment worksheet.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {data ? (
        <>
          <div
            className="shrink-0 border-b bg-background px-6 pb-4"
            data-testid="funding-bucket-sticky"
          >
            <FundingBucketBar
              buckets={data.buckets}
              totals={data.totals}
              accountNameById={accountNameById}
              onAddBucket={openAddBucket}
              onEditBucket={openEditBucket}
              onBalanceBlur={handleBalanceBlur}
              onResetBalance={handleResetBalance}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <div className="space-y-6 pt-6">
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">
                    Credit cards
                    {ccCount > 0 ? ` · ${paidCount} / ${ccCount} paid` : ""}
                  </h2>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground inline-flex rounded-sm"
                        aria-label="Credit card table help"
                      >
                        <CircleHelp className="size-4" aria-hidden />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      Card names open Firefly. Use the pencil to edit bucket,
                      limits, and other account fields. Only Planned and Paid edit
                      inline.
                    </TooltipContent>
                  </Tooltip>
                </div>
                {data.refreshed_at ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManageCardsOpen(true)}
                  >
                    Manage cards
                    {excludedCount > 0 ? ` (${excludedCount} excluded)` : ""}
                  </Button>
                ) : null}
              </div>
              {ccGuidance ? (
                <p className="text-muted-foreground text-sm">{ccGuidance}</p>
              ) : null}
              {ccActionError ? (
                <p className="text-destructive text-sm" role="alert">
                  {ccActionError}
                </p>
              ) : null}
              {data.credit_cards.length > 0 ? (
                <CreditCardsTable
                  rows={data.credit_cards}
                  buckets={data.buckets}
                  month={data.month}
                  fireflyBaseUrl={data.firefly_base_url}
                  onPlannedBlur={handlePlannedBlur}
                  onPaidChange={handleCardPaidChange}
                  onEditDetails={openCardDetails}
                />
              ) : null}
              {data.credit_cards.length === 0 && !data.refreshed_at ? (
                <Card>
                  <CardContent className="text-muted-foreground space-y-2 py-8 text-sm">
                    <p className="font-medium text-foreground">
                      Credit cards load on Refresh
                    </p>
                    <p>
                      Firefly credit card accounts appear here automatically when
                      you click <span className="font-medium">Refresh balances</span>.
                      Add funding buckets first if you want to map cards to cash
                      pools.
                    </p>
                  </CardContent>
                </Card>
              ) : null}
              {data.credit_cards.length === 0 && data.refreshed_at ? (
                <Card>
                  <CardContent className="text-muted-foreground space-y-2 py-8 text-sm">
                    <p className="font-medium text-foreground">
                      No credit cards on this worksheet
                    </p>
                    <p>
                      All cards may be excluded, or Firefly returned no credit card
                      asset accounts. Open <span className="font-medium">Manage cards</span>{" "}
                      to restore excluded cards, or refresh after fixing account roles
                      in Firefly.
                    </p>
                  </CardContent>
                </Card>
              ) : null}
            </section>

            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">
                  Bills · {billsPaidCount} / {billsTotalCount} paid
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void openBillRegistration("bills")}
                >
                  Add bill
                </Button>
              </div>
              {data.bills.length > 0 ? (
                <BillsTable
                  rows={data.bills}
                  buckets={data.buckets}
                  creditCards={data.credit_cards}
                  subtotals={data.section_subtotals.bills}
                  fireflyBaseUrl={data.firefly_base_url}
                  onPlannedBlur={handlePlannedBlur}
                  onAmountDueBlur={handleAmountDueBlur}
                  onPaidChange={handleBillPaidChange}
                  onEditRegistration={openEditBillRegistration}
                />
              ) : (
                <Card>
                  <CardContent className="space-y-3 py-12 text-center">
                    <p className="font-medium">No bills on this worksheet</p>
                    <p className="text-muted-foreground text-sm">
                      Register recurring bills from Firefly or create new ones with
                      a matching rule.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void openBillRegistration("bills")}
                    >
                      Add bill
                    </Button>
                  </CardContent>
                </Card>
              )}
            </section>

            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">
                  Liabilities · {liabilitiesPaidCount} / {liabilitiesTotalCount}{" "}
                  paid
                </h2>
                <div className="flex flex-wrap gap-2">
                  {data.refreshed_at && excludedLiabilitiesCount > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setManageLiabilitiesOpen(true)}
                    >
                      Manage exclusions ({excludedLiabilitiesCount})
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void openBillRegistration("liabilities")}
                  >
                    Add bill
                  </Button>
                </div>
              </div>
              {data.liabilities.length > 0 ? (
                <LiabilitiesTable
                  rows={data.liabilities}
                  buckets={data.buckets}
                  creditCards={data.credit_cards}
                  subtotals={data.section_subtotals.liabilities}
                  fireflyBaseUrl={data.firefly_base_url}
                  onPlannedBlur={handlePlannedBlur}
                  onAmountDueBlur={handleAmountDueBlur}
                  onPaidChange={handleLiabilityPaidChange}
                  onEditRegistration={openEditBillRegistration}
                  onEditAccount={openLiabilityAccount}
                />
              ) : (
                <Card>
                  <CardContent className="space-y-3 py-12 text-center">
                    <p className="font-medium">No liabilities on this worksheet</p>
                    <p className="text-muted-foreground text-sm">
                      Loan and mortgage accounts from Firefly appear here after
                      Refresh. Register bills under Liabilities if you want rent or
                      other items grouped with loans.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void openBillRegistration("liabilities")}
                    >
                      Add bill
                    </Button>
                  </CardContent>
                </Card>
              )}
            </section>

            <WorksheetGrandTotal grandTotals={data.grand_totals} />

            {data.shortfall ? <ShortfallBanner buckets={data.buckets} /> : null}
            </div>
          </div>
        </>
      ) : null}

      <BucketSheet
        open={bucketSheetOpen}
        onOpenChange={setBucketSheetOpen}
        bucket={editingBucket}
        assetAccounts={bucketAssetAccounts}
        onSave={handleSaveBucket}
        onDelete={handleDeleteBucket}
      />

      <ManageCardsSheet
        open={manageCardsOpen}
        onOpenChange={setManageCardsOpen}
        excludedCards={data?.excluded_credit_cards ?? []}
        onInclude={handleIncludeCard}
      />

      <ManageLiabilitiesSheet
        open={manageLiabilitiesOpen}
        onOpenChange={setManageLiabilitiesOpen}
        excludedLiabilities={data?.excluded_liabilities ?? []}
        onInclude={handleIncludeLiability}
      />

      <BillRegistrationSheet
        open={billRegistrationOpen}
        onOpenChange={(open) => {
          setBillRegistrationOpen(open)
          if (!open) {
            setBillEditTarget(null)
            setLinkBillId(null)
          }
        }}
        defaultSection={billRegistrationSection}
        initialMode={billRegistrationMode}
        initialFireflyBillId={linkBillId}
        editTarget={billEditTarget}
        creditCards={data?.credit_cards ?? []}
        buckets={data?.buckets ?? []}
        availableBills={availableBills}
        loadingAvailable={loadingAvailableBills}
        onSubmit={handleRegisterBill}
      />

      <PaymentConfigureSheet
        open={configureOpen}
        onOpenChange={setConfigureOpen}
        initialSection={configureSection}
        buckets={data?.buckets ?? []}
        creditCards={data?.credit_cards ?? []}
        bills={data?.bills ?? []}
        liabilities={data?.liabilities ?? []}
        excludedCreditCards={data?.excluded_credit_cards ?? []}
        excludedLiabilities={data?.excluded_liabilities ?? []}
        accountNameById={accountNameById}
        onRegisterBill={openRegisterBillFromConfigure}
        onEditBill={openEditBillFromConfigure}
        onRemoveBill={setRemoveTarget}
        onLinkBill={openLinkBillFromConfigure}
        onEditCard={openEditCardFromConfigure}
        onEditLiabilityAccount={openEditLiabilityFromConfigure}
        onManageExcludedCards={openManageExcludedCardsFromConfigure}
        onManageExcludedLiabilities={openManageExcludedLiabilitiesFromConfigure}
      />

      <LiabilityAccountSheet
        open={liabilitySheetOpen}
        onOpenChange={setLiabilitySheetOpen}
        row={editingLiability}
        buckets={data?.buckets ?? []}
        loanConfigured={
          editingLiability?.account_id
            ? loanByAccountId.get(editingLiability.account_id)?.configured
            : false
        }
        loanExpectedAmount={
          editingLiability?.account_id
            ? loanByAccountId.get(editingLiability.account_id)?.expectedAmount ??
              null
            : null
        }
        onSave={handleLiabilityAccountSave}
        onExclude={handleExcludeLiability}
      />

      <Sheet
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
      >
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              Remove {removeTarget?.name ?? "bill"} from worksheet?
            </SheetTitle>
            <SheetDescription>
              The Firefly bill and rule are not deleted.
            </SheetDescription>
          </SheetHeader>
          {removeError ? (
            <p className="text-destructive px-4 text-sm">{removeError}</p>
          ) : null}
          <SheetFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={removingBill}
              onClick={() => setRemoveTarget(null)}
            >
              Keep on worksheet
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={removingBill}
              onClick={() => void handleConfirmRemoveBill()}
            >
              {removingBill ? "Removing…" : "Remove"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <CreditCardSheet
        open={cardSheetOpen}
        onOpenChange={setCardSheetOpen}
        row={editingCard}
        buckets={data?.buckets ?? []}
        onSave={handleCardDetailsSave}
        onExclude={handleExclude}
      />
    </div>
  )
}
