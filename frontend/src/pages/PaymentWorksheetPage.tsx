import { useMemo, useState } from "react"
import { Navigate } from "react-router-dom"
import { CircleHelp, RefreshCw } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { BucketSheet } from "@/components/payment-run/BucketSheet"
import { CreditCardSheet } from "@/components/payment-run/CreditCardSheet"
import type { CreditCardDetailsInput } from "@/components/payment-run/CreditCardSheet"
import { CreditCardsTable } from "@/components/payment-run/CreditCardsTable"
import { ManageCardsSheet } from "@/components/payment-run/ManageCardsSheet"
import { FundingBucketBar } from "@/components/payment-run/FundingBucketBar"
import { ShortfallBanner } from "@/components/payment-run/ShortfallBanner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useHealth } from "@/hooks/useHealth"
import { useLoanMeta } from "@/hooks/useLoans"
import { isFundingBucketAsset } from "@/lib/accounts"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import {
  createFundingBucket,
  currentMonthKey,
  deleteFundingBucket,
  fetchFundingBuckets,
  formatMonthLabel,
  putBucketBalance,
  putRowState,
  putAccountWorksheet,
  refreshPaymentWorksheet,
  updateFundingBucket,
  type FundingBucket,
  type FundingBucketRollup,
  type CreditCardRow,
} from "@/lib/paymentRunApi"

function formatRefreshedAt(value: string | null | undefined): string {
  if (!value) return "Not refreshed this month"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `Last refreshed ${date.toLocaleString()}`
}

export function PaymentWorksheetPage() {
  const month = currentMonthKey()
  const queryClient = useQueryClient()
  const { data: health, isPending: healthPending } = useHealth()
  const { data, isPending, isError, refetch } = usePaymentWorksheet(month)
  const { data: loanMeta } = useLoanMeta()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [ccActionError, setCcActionError] = useState<string | null>(null)
  const [bucketSheetOpen, setBucketSheetOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<FundingBucket | null>(null)
  const [cardSheetOpen, setCardSheetOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<CreditCardRow | null>(null)
  const [manageCardsOpen, setManageCardsOpen] = useState(false)

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

  async function handleBalanceBlur(bucketId: string, value: string) {
    await putBucketBalance(bucketId, month, { user_balance: value })
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

  async function handlePlannedBlur(rowKey: string, value: string) {
    await putRowState(rowKey, month, { planned_amount: value })
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handlePaidChange(row: CreditCardRow, paid: boolean) {
    if (paid) {
      await putRowState(row.row_key, month, {
        paid_at: new Date().toISOString(),
      })
    } else {
      await putRowState(row.row_key, month, { clear_paid: true })
    }
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
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

  async function handleInclude(accountId: string) {
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

  const paidCount = data?.credit_cards.filter((row) => row.paid_at).length ?? 0
  const ccCount = data?.credit_cards.length ?? 0
  const excludedCount = data?.excluded_credit_cards.length ?? 0

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Payment Worksheet
          </h1>
          <p className="text-muted-foreground text-sm">
            Plan credit card paydowns for {formatMonthLabel(month)} — balances
            from Firefly on Refresh.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className="text-muted-foreground text-sm">
            {formatRefreshedAt(data?.refreshed_at)}
          </span>
          <Button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || isPending}
          >
            <RefreshCw
              className={refreshing ? "mr-2 size-4 animate-spin" : "mr-2 size-4"}
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
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <>
          <FundingBucketBar
            buckets={data.buckets}
            totals={data.totals}
            accountNameById={accountNameById}
            onAddBucket={openAddBucket}
            onEditBucket={openEditBucket}
            onBalanceBlur={handleBalanceBlur}
            onResetBalance={handleResetBalance}
          />

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
                onPaidChange={handlePaidChange}
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
            {data.shortfall ? <ShortfallBanner buckets={data.buckets} /> : null}
          </section>
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
        onInclude={handleInclude}
      />

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
