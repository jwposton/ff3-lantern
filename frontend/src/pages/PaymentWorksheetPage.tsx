import { useMemo, useState } from "react"
import { Link, Navigate, useSearchParams } from "react-router-dom"
import { CircleHelp, RefreshCw, Settings2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import {
  BillRegistrationSheet,
  type BillRegistrationEditTarget,
} from "@/components/payment-run/BillRegistrationSheet"
import { BillsTable, countPaidRows } from "@/components/payment-run/BillsTable"
import { CreditCardSheet } from "@/components/payment-run/CreditCardSheet"
import type { CreditCardDetailsInput } from "@/components/payment-run/CreditCardSheet"
import { CreditCardsTable } from "@/components/payment-run/CreditCardsTable"
import {
  LiabilityAccountSheet,
  type LiabilityAccountDetailsInput,
} from "@/components/payment-run/LiabilityAccountSheet"
import { LiabilitiesTable } from "@/components/payment-run/LiabilitiesTable"
import { FundingBucketBar } from "@/components/payment-run/FundingBucketBar"
import { ShortfallBanner } from "@/components/payment-run/ShortfallBanner"
import { WorksheetGrandTotal } from "@/components/payment-run/WorksheetGrandTotal"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useHealth } from "@/hooks/useHealth"
import { registeredBillsQueryKey } from "@/hooks/useBillHistory"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import { useLoanMeta, useLoans } from "@/hooks/useLoans"
import {
  billGroupsQueryKey,
  currentMonthKey,
  formatMonthLabel,
  putAccountWorksheet,
  putBucketBalance,
  putRowState,
  refreshPaymentWorksheet,
  updateBillRegistry,
  type BillRow,
  type CreditCardRow,
  type LiabilityRow,
  type RegisterBillPayload,
} from "@/lib/paymentRunApi"

function formatRefreshedAt(value: string | null | undefined): string {
  if (!value) return "Not refreshed this month"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function PaymentWorksheetPage() {
  const month = currentMonthKey()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { data: health, isPending: healthPending } = useHealth()
  const { data, isPending, isError, refetch } = usePaymentWorksheet(month)
  const { data: loanMeta } = useLoanMeta()
  const { data: loansData } = useLoans()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [ccActionError, setCcActionError] = useState<string | null>(null)
  const [cardSheetOpen, setCardSheetOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<CreditCardRow | null>(null)
  const [liabilitySheetOpen, setLiabilitySheetOpen] = useState(false)
  const [editingLiability, setEditingLiability] = useState<LiabilityRow | null>(
    null,
  )
  const [billRegistrationOpen, setBillRegistrationOpen] = useState(false)
  const [billRegistrationSection, setBillRegistrationSection] = useState<
    "bills" | "liabilities"
  >("bills")
  const [billEditTarget, setBillEditTarget] =
    useState<BillRegistrationEditTarget | null>(null)

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const account of loanMeta?.asset_accounts ?? []) {
      map.set(account.id, account.name)
    }
    return map
  }, [loanMeta])

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

  const ccGuidance = useMemo(() => {
    if (!data) return null
    if (data.credit_cards.length === 0) {
      if (!data.refreshed_at) {
        return (
          "Credit cards load from Firefly when you click Refresh balances — " +
          "there is no separate add step. Add cash accounts first if needed."
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
      return "Map cards to cash accounts to see planned outflows"
    }
    return null
  }, [data])

  if (searchParams.get("configure") === "1") {
    return <Navigate to="/manage/payment-run/setup" replace />
  }

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

  async function handlePaidChange(rowKey: string, paid: boolean) {
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

  async function handleExcludeCard(row: CreditCardRow) {
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
    setBillRegistrationOpen(true)
  }

  async function handleRegisterBill(payload: RegisterBillPayload) {
    if (!billEditTarget) return
    await updateBillRegistry(billEditTarget.registryId, {
      name: payload.name,
      row_label: payload.name,
      amount_mode: payload.amount_mode,
      worksheet_section: payload.worksheet_section,
      payment_rail: payload.payment_rail,
      funding_bucket_key: payload.funding_bucket_key,
      credit_card_account_id: payload.credit_card_account_id,
      amount_min: payload.amount_min,
      amount_max: payload.amount_max,
      repeat_freq: payload.repeat_freq,
      bill_group_id: payload.bill_group_id,
      show_in_group: payload.show_in_group,
    })
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
    await queryClient.invalidateQueries({ queryKey: registeredBillsQueryKey() })
    await queryClient.invalidateQueries({ queryKey: billGroupsQueryKey() })
    setBillRegistrationOpen(false)
    setBillEditTarget(null)
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 px-6 pb-6 pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Payment Worksheet
              </h1>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground inline-flex rounded-sm"
                    aria-label="Payment worksheet help"
                  >
                    <CircleHelp className="size-4" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  Plan credit cards, bills, and liabilities for{" "}
                  {formatMonthLabel(month)} — balances from Firefly when you click
                  Refresh balances.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-muted-foreground text-xs tabular-nums"
                title={
                  data?.refreshed_at
                    ? `Last refreshed ${data.refreshed_at}`
                    : undefined
                }
              >
                {formatRefreshedAt(data?.refreshed_at)}
              </span>
              <Link
                to="/manage/payment-run/discover"
                className="text-sm font-medium text-primary"
              >
                Find bills →
              </Link>
              <Button asChild type="button" variant="outline" size="sm">
                <Link to="/manage/payment-run/setup">
                  <Settings2 className="mr-2 size-4" />
                  Payment setup
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
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

          {refreshError ? (
            <p className="text-destructive text-sm">{refreshError}</p>
          ) : null}

          {ccActionError ? (
            <p className="text-destructive text-sm">{ccActionError}</p>
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                >
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {data ? (
            <>
              <div
                className="sticky top-0 z-10 -mx-6 border-b bg-background px-6 py-2"
                data-testid="funding-bucket-sticky"
              >
                <FundingBucketBar
                  buckets={data.buckets}
                  totals={data.totals}
                  accountNameById={accountNameById}
                  onBalanceBlur={handleBalanceBlur}
                  onResetBalance={handleResetBalance}
                />
              </div>

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
                          Card names open Firefly. Use Manage to edit that
                          card's bucket and limits. Only Planned and Paid edit
                          inline.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {data.refreshed_at ? (
                      <Button asChild type="button" variant="outline" size="sm">
                        <Link to="/manage/payment-run/cards">
                          Manage cards
                          {excludedCount > 0
                            ? ` (${excludedCount} excluded)`
                            : ""}
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                  {ccGuidance ? (
                    <p className="text-muted-foreground text-sm">{ccGuidance}</p>
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
                          Firefly credit card accounts appear here automatically
                          when you click{" "}
                          <span className="font-medium">Refresh balances</span>.
                          Add cash accounts in{" "}
                          <Link
                            to="/manage/payment-run/buckets"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Cash accounts
                          </Link>{" "}
                          first if you want to map cards to cash pools.
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
                          All cards may be excluded, or Firefly returned no credit
                          card asset accounts. Open{" "}
                          <Link
                            to="/manage/payment-run/cards"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Manage cards
                          </Link>{" "}
                          to restore excluded cards, or refresh after fixing account
                          roles in Firefly.
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
                    <Button asChild type="button" variant="outline" size="sm">
                      <Link to="/manage/bills">Add bill in Bills</Link>
                    </Button>
                  </div>
                  {data.bills.length > 0 ? (
                    <BillsTable
                      rows={data.bills}
                      billGroups={data.bill_groups}
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
                          Register recurring bills from Firefly or create new ones
                          on the Bills hub.
                        </p>
                        <Button asChild type="button" variant="outline" size="sm">
                          <Link to="/manage/bills">Add bill in Bills</Link>
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </section>

                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xl font-semibold">
                      Liabilities · {liabilitiesPaidCount} /{" "}
                      {liabilitiesTotalCount} paid
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {data.refreshed_at && excludedLiabilitiesCount > 0 ? (
                        <Button asChild type="button" variant="outline" size="sm">
                          <Link to="/manage/liabilities">
                            Manage exclusions ({excludedLiabilitiesCount})
                          </Link>
                        </Button>
                      ) : null}
                      <Button asChild type="button" variant="outline" size="sm">
                        <Link to="/manage/bills">Add bill in Bills</Link>
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
                        <p className="font-medium">
                          No liabilities on this worksheet
                        </p>
                        <p className="text-muted-foreground text-sm">
                          Loan and mortgage accounts from Firefly appear here after
                          Refresh. Register bills under Liabilities on the Bills
                          hub if you want rent or other items grouped with loans.
                        </p>
                        <Button asChild type="button" variant="outline" size="sm">
                          <Link to="/manage/bills">Add bill in Bills</Link>
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </section>

                <WorksheetGrandTotal grandTotals={data.grand_totals} />

                {data.shortfall ? <ShortfallBanner buckets={data.buckets} /> : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <BillRegistrationSheet
        open={billRegistrationOpen}
        onOpenChange={(open) => {
          setBillRegistrationOpen(open)
          if (!open) setBillEditTarget(null)
        }}
        defaultSection={billRegistrationSection}
        initialMode="create_new"
        editTarget={billEditTarget}
        creditCards={data?.credit_cards ?? []}
        buckets={data?.buckets ?? []}
        availableBills={[]}
        onSubmit={handleRegisterBill}
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

      <CreditCardSheet
        open={cardSheetOpen}
        onOpenChange={setCardSheetOpen}
        row={editingCard}
        buckets={data?.buckets ?? []}
        onSave={handleCardDetailsSave}
        onExclude={handleExcludeCard}
      />
    </div>
  )
}
