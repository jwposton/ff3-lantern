import { useMemo, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Link, Navigate, useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { MetricBlock } from "@/components/MetricBlock"
import { CreditCardActivityChart } from "@/components/payment-run/CreditCardActivityChart"
import { CreditCardHistoryTable } from "@/components/payment-run/CreditCardHistoryTable"
import { CreditCardSheet } from "@/components/payment-run/CreditCardSheet"
import type { CreditCardDetailsInput } from "@/components/payment-run/CreditCardSheet"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  creditCardHistoryQueryKey,
  useCreditCardHistory,
} from "@/hooks/useCreditCardHistory"
import { useDateRange } from "@/context/DateRangeContext"
import { useHealth } from "@/hooks/useHealth"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import { creditCardNetChangeClassName, formatStatsWindowCaption } from "@/lib/creditCardHistory"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import {
  currentMonthKey,
  putAccountWorksheet,
  type CreditCardRow,
} from "@/lib/paymentRunApi"

export function CreditCardDetailPage() {
  const { accountId } = useParams()
  const month = currentMonthKey()
  const { committedRange } = useDateRange()
  const queryClient = useQueryClient()
  const { data: health, isPending: healthPending } = useHealth()
  const { data: worksheet, isPending: worksheetPending } =
    usePaymentWorksheet(month)
  const {
    data: history,
    isPending: historyPending,
    isError: historyError,
    refetch: refetchHistory,
  } = useCreditCardHistory(accountId ?? null, committedRange)
  const [cardSheetOpen, setCardSheetOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const worksheetRow = useMemo(
    () =>
      worksheet?.credit_cards.find((row) => row.account_id === accountId) ??
      null,
    [worksheet, accountId],
  )

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  if (!worksheetPending && accountId && worksheet && !worksheetRow) {
    return <Navigate to="/manage/payment-run/cards" replace />
  }

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
    if (accountId) {
      await queryClient.invalidateQueries({
        queryKey: creditCardHistoryQueryKey(accountId, committedRange),
      })
    }
  }

  async function handleSave(
    targetAccountId: string,
    values: CreditCardDetailsInput,
  ) {
    setActionError(null)
    try {
      await putAccountWorksheet(targetAccountId, month, values)
      await invalidate()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not save card details.",
      )
      throw err
    }
  }

  async function handleExclude(row: CreditCardRow) {
    await putAccountWorksheet(row.account_id, month, { included: false })
    await invalidate()
  }

  function bucketLabel(bucketKey: string | null | undefined): string {
    if (!bucketKey) return "—"
    return (
      worksheet?.buckets.find((bucket) => bucket.id === bucketKey)?.label ??
      bucketKey
    )
  }

  const displayName =
    history?.account.name ??
    worksheetRow?.name ??
    accountId ??
    "Credit card"
  const owed =
    history?.account.owed ??
    worksheetRow?.owed ??
    "0.00"
  const apr =
    history?.account.apr_percent ?? worksheetRow?.apr_percent ?? null
  const statsCaption = formatStatsWindowCaption(history?.stats_window)

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2">
          <Link to="/manage/payment-run/cards">
            <ArrowLeft className="mr-2 size-4" />
            Credit cards
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {displayName}
            </h1>
            <p className="text-muted-foreground text-sm">
              Balance {formatDisplayAmount(owed)}
              {apr ? ` · APR ${apr}%` : ""}
              {" · "}
              {bucketLabel(
                history?.account.funding_bucket_key ??
                  worksheetRow?.funding_bucket_key,
              )}
            </p>
            {statsCaption ? (
              <p className="text-muted-foreground text-xs">
                KPIs cover {statsCaption}
              </p>
            ) : null}
          </div>
          {worksheetRow ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCardSheetOpen(true)}
            >
              Edit settings
            </Button>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p className="text-destructive text-sm" role="alert">
          {actionError}
        </p>
      ) : null}

      {historyError ? (
        <div className="rounded-lg border border-destructive/50 bg-card p-4 space-y-3">
          <p className="text-destructive text-sm">
            Could not load card history. Try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetchHistory()}>
            Try again
          </Button>
        </div>
      ) : null}

      {historyPending ? (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : history ? (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <MetricBlock
                label="Charges"
                value={formatDisplayAmount(history.totals.charges)}
              />
              <MetricBlock
                label="Fees"
                value={formatDisplayAmount(history.totals.fees)}
              />
              <MetricBlock
                label="Interest"
                value={formatDisplayAmount(history.totals.interest)}
              />
              <MetricBlock
                label="Payments"
                value={formatDisplayAmount(history.totals.payments)}
              />
              <MetricBlock
                label="Net change"
                value={formatDisplayAmount(history.totals.net_change)}
                hint="Charges + interest − payments"
                valueClassName={creditCardNetChangeClassName(
                  history.totals.net_change,
                )}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <CreditCardActivityChart
        monthly={history?.monthly ?? []}
        loading={historyPending}
      />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Transactions</h2>
        {historyPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <CreditCardHistoryTable
            transactions={history?.transactions ?? []}
            fireflyBaseUrl={history?.firefly_base_url}
          />
        )}
      </div>

      {worksheetRow ? (
        <CreditCardSheet
          open={cardSheetOpen}
          onOpenChange={setCardSheetOpen}
          row={worksheetRow}
          buckets={worksheet?.buckets ?? []}
          onSave={handleSave}
          onExclude={handleExclude}
        />
      ) : null}
    </div>
  )
}
