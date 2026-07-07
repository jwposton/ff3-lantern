import { useMemo, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Link, Navigate, useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { MetricBlock } from "@/components/MetricBlock"
import { LiabilityAccountSheet } from "@/components/payment-run/LiabilityAccountSheet"
import type { LiabilityAccountDetailsInput } from "@/components/payment-run/LiabilityAccountSheet"
import { LiabilityActivityChart } from "@/components/payment-run/LiabilityActivityChart"
import { LiabilityHistoryTable } from "@/components/payment-run/LiabilityHistoryTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDateRange } from "@/context/DateRangeContext"
import { useHealth } from "@/hooks/useHealth"
import { useLoans } from "@/hooks/useLoans"
import {
  liabilityHistoryQueryKey,
  useLiabilityHistory,
} from "@/hooks/useLiabilityHistory"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import { formatStatsWindowCaption } from "@/lib/liabilityHistory"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import {
  currentMonthKey,
  putAccountWorksheet,
  type LiabilityRow,
} from "@/lib/paymentRunApi"

export function LiabilityDetailPage() {
  const { accountId } = useParams()
  const month = currentMonthKey()
  const { committedRange } = useDateRange()
  const queryClient = useQueryClient()
  const { data: health, isPending: healthPending } = useHealth()
  const { data: worksheet, isPending: worksheetPending } =
    usePaymentWorksheet(month)
  const { data: loansData } = useLoans()
  const {
    data: history,
    isPending: historyPending,
    isError: historyError,
    refetch: refetchHistory,
  } = useLiabilityHistory(accountId ?? null, committedRange)
  const [liabilitySheetOpen, setLiabilitySheetOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const worksheetRow = useMemo(
    () =>
      worksheet?.liabilities.find(
        (row) => row.account_id === accountId && !row.registry_id,
      ) ?? null,
    [worksheet, accountId],
  )

  const loanMeta = useMemo(() => {
    if (!accountId) return null
    const loan = loansData?.data.find((row) => row.account_id === accountId)
    if (!loan) return { configured: false, expectedAmount: null as string | null }
    return {
      configured: loan.configured,
      expectedAmount: loan.profile?.match.expected_amount ?? null,
    }
  }, [accountId, loansData])

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  if (!worksheetPending && accountId && worksheet && !worksheetRow) {
    return <Navigate to="/manage/liabilities" replace />
  }

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
    if (accountId) {
      await queryClient.invalidateQueries({
        queryKey: liabilityHistoryQueryKey(accountId, committedRange),
      })
    }
  }

  async function handleSave(
    targetAccountId: string,
    values: LiabilityAccountDetailsInput,
  ) {
    setActionError(null)
    try {
      await putAccountWorksheet(targetAccountId, month, values)
      await invalidate()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not save liability settings.",
      )
      throw err
    }
  }

  async function handleExclude(row: LiabilityRow) {
    if (!row.account_id) return
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
    history?.account.name ?? worksheetRow?.name ?? accountId ?? "Liability"
  const owed = history?.account.owed ?? worksheetRow?.owed ?? "0.00"
  const loanConfigured =
    history?.account.loan_configured ?? loanMeta?.configured ?? false
  const statsCaption = formatStatsWindowCaption(history?.stats_window)

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2">
          <Link to="/manage/liabilities">
            <ArrowLeft className="mr-2 size-4" />
            Liabilities
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {displayName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Balance {formatDisplayAmount(owed)}</span>
              <span>·</span>
              <span>
                {bucketLabel(
                  history?.account.funding_bucket_key ??
                    worksheetRow?.funding_bucket_key,
                )}
              </span>
              <Badge variant={loanConfigured ? "default" : "secondary"}>
                {loanConfigured ? "Loan configured" : "Not configured"}
              </Badge>
            </div>
            {statsCaption ? (
              <p className="text-muted-foreground text-xs">
                KPIs cover {statsCaption}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {accountId ? (
              <Button asChild size="sm" variant="outline">
                <Link to={`/manage/loans/${encodeURIComponent(accountId)}`}>
                  Loan profile
                </Link>
              </Button>
            ) : null}
            {worksheetRow ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLiabilitySheetOpen(true)}
              >
                Worksheet
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {actionError ? (
        <p className="text-destructive text-sm" role="alert">
          {actionError}
        </p>
      ) : null}

      {!loanConfigured && history?.history_meta?.anchor_journal_count === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No payments found in Firefly</p>
            <p>
              Lantern looks for journal splits that post to this liability account (
              {displayName}). A multi-line split is not required — a single transfer into
              this account counts. If you pay via expense accounts only, those will not
              appear here.
            </p>
            {accountId ? (
              <Button asChild size="sm" variant="outline">
                <Link to={`/manage/loans/${encodeURIComponent(accountId)}`}>
                  Configure loan profile
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : !loanConfigured ? (
        <Card>
          <CardContent className="space-y-2 py-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Loan profile not configured
            </p>
            <p>
              Payments into this liability account are shown below. Open the loan
              profile to review inferred split destinations and match fingerprint, then
              save.
            </p>
            {accountId ? (
              <Button asChild size="sm" variant="outline">
                <Link to={`/manage/loans/${encodeURIComponent(accountId)}`}>
                  Configure loan profile
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {historyError ? (
        <div className="rounded-lg border border-destructive/50 bg-card p-4 space-y-3">
          <p className="text-destructive text-sm">
            Could not load liability history. Try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetchHistory()}>
            Try again
          </Button>
        </div>
      ) : null}

      {historyPending ? (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : history ? (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <MetricBlock
                label="Principal"
                value={formatDisplayAmount(history.totals.principal)}
              />
              <MetricBlock
                label="Interest"
                value={formatDisplayAmount(history.totals.interest)}
              />
              <MetricBlock
                label="Total payments"
                value={formatDisplayAmount(history.totals.total_payment)}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <LiabilityActivityChart
        monthly={history?.monthly ?? []}
        loading={historyPending}
      />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Payments</h2>
        {historyPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <LiabilityHistoryTable
            transactions={history?.transactions ?? []}
            fireflyBaseUrl={history?.firefly_base_url}
          />
        )}
      </div>

      {worksheetRow ? (
        <LiabilityAccountSheet
          open={liabilitySheetOpen}
          onOpenChange={setLiabilitySheetOpen}
          row={worksheetRow}
          buckets={worksheet?.buckets ?? []}
          loanConfigured={loanMeta?.configured ?? false}
          loanExpectedAmount={loanMeta?.expectedAmount ?? null}
          onSave={handleSave}
          onExclude={handleExclude}
        />
      ) : null}
    </div>
  )
}
