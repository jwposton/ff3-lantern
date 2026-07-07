import { useEffect, useMemo, useRef, useState } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { MetricBlock } from "@/components/MetricBlock"
import { LiabilityAccountSheet } from "@/components/payment-run/LiabilityAccountSheet"
import type { LiabilityAccountDetailsInput } from "@/components/payment-run/LiabilityAccountSheet"
import { ManageLiabilitiesSheet } from "@/components/payment-run/ManageLiabilitiesSheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDateRange } from "@/context/DateRangeContext"
import { useHealth } from "@/hooks/useHealth"
import { useLoans } from "@/hooks/useLoans"
import { useLiabilityPortfolioHistories } from "@/hooks/useLiabilityHistory"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import {
  aggregateLiabilityPortfolioTotals,
  formatStatsWindowCaption,
  sumLiabilityBalances,
} from "@/lib/liabilityHistory"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import {
  currentMonthKey,
  putAccountWorksheet,
  type LiabilityRow,
} from "@/lib/paymentRunApi"

export function LiabilitiesHubPage() {
  const month = currentMonthKey()
  const { committedRange } = useDateRange()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const deepLinkHandled = useRef(false)
  const { data: health, isPending: healthPending } = useHealth()
  const { data, isPending } = usePaymentWorksheet(month)
  const { data: loansData, isPending: loansPending } = useLoans()
  const [liabilitySheetOpen, setLiabilitySheetOpen] = useState(false)
  const [editingLiability, setEditingLiability] = useState<LiabilityRow | null>(
    null,
  )
  const [manageLiabilitiesOpen, setManageLiabilitiesOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  const liabilityAccounts = useMemo(
    () =>
      (data?.liabilities ?? []).filter(
        (row) => row.account_id && !row.registry_id,
      ),
    [data?.liabilities],
  )

  const accountIds = useMemo(
    () => liabilityAccounts.map((row) => row.account_id!),
    [liabilityAccounts],
  )
  const portfolioQueries = useLiabilityPortfolioHistories(accountIds, committedRange)
  const portfolioLoading =
    accountIds.length > 0 && portfolioQueries.some((query) => query.isPending)
  const portfolioError = portfolioQueries.some((query) => query.isError)
  const portfolioHistories = useMemo(
    () =>
      portfolioQueries
        .map((query) => query.data)
        .filter((row): row is NonNullable<typeof row> => row != null),
    [portfolioQueries],
  )
  const portfolioTotals = useMemo(
    () => aggregateLiabilityPortfolioTotals(portfolioHistories),
    [portfolioHistories],
  )
  const totalBalance = useMemo(
    () =>
      sumLiabilityBalances(
        liabilityAccounts.map((row) => row.owed ?? "0"),
      ),
    [liabilityAccounts],
  )
  const statsCaption = formatStatsWindowCaption(
    portfolioHistories[0]?.stats_window,
  )

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  async function invalidateWorksheet() {
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handleLiabilityAccountSave(
    accountId: string,
    values: LiabilityAccountDetailsInput,
  ) {
    setActionError(null)
    try {
      await putAccountWorksheet(accountId, month, values)
      await invalidateWorksheet()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not save liability settings.",
      )
      throw err
    }
  }

  async function handleExcludeLiability(row: LiabilityRow) {
    if (!row.account_id) return
    setActionError(null)
    try {
      await putAccountWorksheet(row.account_id, month, { included: false })
      await invalidateWorksheet()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not exclude liability.",
      )
    }
  }

  async function handleIncludeLiability(accountId: string) {
    setActionError(null)
    try {
      await putAccountWorksheet(accountId, month, { included: true })
      await invalidateWorksheet()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not restore liability."
      setActionError(message)
      throw new Error(message)
    }
  }

  function openLiabilityAccount(row: LiabilityRow) {
    setEditingLiability(row)
    setLiabilitySheetOpen(true)
  }

  function bucketLabel(bucketKey: string | null): string {
    if (!bucketKey) return "—"
    return data?.buckets.find((bucket) => bucket.id === bucketKey)?.label ?? bucketKey
  }

  const excludedCount = data?.excluded_liabilities.length ?? 0

  useEffect(() => {
    const accountParam = searchParams.get("account")
    if (!accountParam || deepLinkHandled.current || liabilityAccounts.length === 0) {
      return
    }
    const match = liabilityAccounts.find((row) => row.account_id === accountParam)
    if (!match) return
    deepLinkHandled.current = true
    navigate(`/manage/liabilities/${accountParam}`, { replace: true })
  }, [liabilityAccounts, navigate, searchParams])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Liabilities
          </h1>
          <p className="text-muted-foreground text-sm">
            Loan accounts on the worksheet. Planned amounts and paid status stay
            on the{" "}
            <Link
              to="/manage/payment-run"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              worksheet
            </Link>
            .
          </p>
          {statsCaption ? (
            <p className="text-muted-foreground text-xs">
              Portfolio KPIs cover {statsCaption}
            </p>
          ) : null}
        </div>
        {excludedCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setManageLiabilitiesOpen(true)}
          >
            Restore excluded ({excludedCount})
          </Button>
        ) : null}
      </div>

      {actionError ? (
        <p className="text-destructive text-sm" role="alert">
          {actionError}
        </p>
      ) : null}

      {isPending || healthPending || loansPending ? (
        <Skeleton className="h-32 w-full" />
      ) : liabilityAccounts.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-8 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              No liability accounts on the worksheet
            </p>
            <p>
              Refresh balances on the{" "}
              <Link
                to="/manage/payment-run"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                payment worksheet
              </Link>{" "}
              to load loan accounts from Firefly.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {portfolioLoading ? (
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-16 w-full" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricBlock
                    label="Total balance"
                    value={formatDisplayAmount(totalBalance)}
                  />
                  <MetricBlock
                    label="Principal"
                    value={formatDisplayAmount(portfolioTotals.principal)}
                  />
                  <MetricBlock
                    label="Interest"
                    value={formatDisplayAmount(portfolioTotals.interest)}
                  />
                  <MetricBlock
                    label="Total payments"
                    value={formatDisplayAmount(portfolioTotals.total_payment)}
                  />
                </div>
                {portfolioError ? (
                  <p className="text-muted-foreground mt-4 text-xs">
                    Some liability history could not be loaded; totals may be
                    incomplete.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          )}

          <ul className="divide-y rounded-md border">
            {liabilityAccounts.map((row) => {
              const accountId = row.account_id!
              const loan = loanByAccountId.get(accountId)
              const configured = loan?.configured ?? false
              return (
                <li
                  key={accountId}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 space-y-1">
                    <Link
                      to={`/manage/liabilities/${encodeURIComponent(accountId)}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {row.name ?? accountId}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={configured ? "default" : "secondary"}>
                        {configured ? "Loan configured" : "Not configured"}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {bucketLabel(row.funding_bucket_key)}
                        {" · "}
                        Balance {formatDisplayAmount(row.owed ?? "0")}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link
                        to={`/manage/liabilities/${encodeURIComponent(accountId)}`}
                      >
                        View
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/manage/loans/${accountId}`}>Loan profile</Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openLiabilityAccount(row)}
                    >
                      Worksheet
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <p className="text-muted-foreground text-xs">
        Bill-backed rows in Liabilities (e.g. rent) are managed under{" "}
        <Link
          to="/manage/bills"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Bills
        </Link>
        .
      </p>

      <ManageLiabilitiesSheet
        open={manageLiabilitiesOpen}
        onOpenChange={setManageLiabilitiesOpen}
        excludedLiabilities={data?.excluded_liabilities ?? []}
        onInclude={handleIncludeLiability}
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
    </div>
  )
}
