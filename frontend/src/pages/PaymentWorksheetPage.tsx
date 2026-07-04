import { useMemo, useState } from "react"
import { Link, Navigate, useSearchParams } from "react-router-dom"
import { CircleHelp, RefreshCw, Settings2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { BillsTable, countPaidRows } from "@/components/payment-run/BillsTable"
import { CreditCardsTable } from "@/components/payment-run/CreditCardsTable"
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
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import { useLoanMeta } from "@/hooks/useLoans"
import {
  currentMonthKey,
  formatMonthLabel,
  putBucketBalance,
  putRowState,
  refreshPaymentWorksheet,
  type BillRow,
  type CreditCardRow,
  type LiabilityRow,
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
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

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
          "there is no separate add step. Add funding buckets first if needed."
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
                          Card names open Firefly. Use Manage to edit bucket and
                          limits on the Credit cards hub. Only Planned and Paid
                          edit inline.
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
                          Add funding buckets in{" "}
                          <Link
                            to="/manage/payment-run/buckets"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Cash buckets
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
                      buckets={data.buckets}
                      creditCards={data.credit_cards}
                      subtotals={data.section_subtotals.bills}
                      fireflyBaseUrl={data.firefly_base_url}
                      onPlannedBlur={handlePlannedBlur}
                      onAmountDueBlur={handleAmountDueBlur}
                      onPaidChange={handleBillPaidChange}
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
    </div>
  )
}
