import { useMemo, useState } from "react"
import { Navigate } from "react-router-dom"
import { RefreshCw } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { BucketSheet } from "@/components/payment-run/BucketSheet"
import { CreditCardsTable } from "@/components/payment-run/CreditCardsTable"
import { FundingBucketBar } from "@/components/payment-run/FundingBucketBar"
import { ShortfallBanner } from "@/components/payment-run/ShortfallBanner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useHealth } from "@/hooks/useHealth"
import { useLoanMeta } from "@/hooks/useLoans"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import {
  createFundingBucket,
  currentMonthKey,
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
  const [bucketSheetOpen, setBucketSheetOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<FundingBucket | null>(null)

  const assetAccounts = loanMeta?.asset_accounts ?? []

  const ccGuidance = useMemo(() => {
    if (!data) return null
    if (data.credit_cards.length === 0) {
      if (!data.refreshed_at) {
        return "Refresh balances to load credit cards"
      }
      return "No credit cards on this worksheet"
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

  async function handleBucketChange(
    accountId: string,
    bucketKey: string | null,
  ) {
    await putAccountWorksheet(accountId, month, {
      funding_bucket_key: bucketKey,
    })
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handleExclude(row: CreditCardRow) {
    await putAccountWorksheet(row.account_id, month, { included: false })
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  const paidCount = data?.credit_cards.filter((row) => row.paid_at).length ?? 0
  const ccCount = data?.credit_cards.length ?? 0

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
            onAddBucket={openAddBucket}
            onEditBucket={openEditBucket}
            onBalanceBlur={handleBalanceBlur}
            onResetBalance={handleResetBalance}
          />

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">
                Credit cards
                {ccCount > 0 ? ` · ${paidCount} / ${ccCount} paid` : ""}
              </h2>
            </div>
            {ccGuidance ? (
              <p className="text-muted-foreground text-sm">{ccGuidance}</p>
            ) : null}
            {data.credit_cards.length > 0 ? (
              <CreditCardsTable
                rows={data.credit_cards}
                buckets={data.buckets}
                onPlannedBlur={handlePlannedBlur}
                onPaidChange={handlePaidChange}
                onBucketChange={handleBucketChange}
                onExclude={handleExclude}
              />
            ) : null}
            {data.credit_cards.length === 0 && data.refreshed_at ? (
              <Card>
                <CardContent className="text-muted-foreground space-y-2 py-8 text-sm">
                  <p className="font-medium text-foreground">
                    No credit cards on this worksheet
                  </p>
                  <p>
                    Firefly credit card accounts appear here after you refresh.
                    Excluded cards stay hidden until you include them again.
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
        assetAccounts={assetAccounts}
        onSave={handleSaveBucket}
      />
    </div>
  )
}
