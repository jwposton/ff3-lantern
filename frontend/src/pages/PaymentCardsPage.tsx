import { useEffect, useMemo, useRef, useState } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { MetricBlock } from "@/components/MetricBlock"
import { CreditCardSheet } from "@/components/payment-run/CreditCardSheet"
import type { CreditCardDetailsInput } from "@/components/payment-run/CreditCardSheet"
import { ManageCardsSheet } from "@/components/payment-run/ManageCardsSheet"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useCreditCardPortfolioHistories } from "@/hooks/useCreditCardHistory"
import { useHealth } from "@/hooks/useHealth"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import {
  aggregateCreditCardPortfolioTotals,
  creditCardNetChangeClassName,
  formatStatsWindowCaption,
  sumCardBalances,
} from "@/lib/creditCardHistory"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import {
  currentMonthKey,
  putAccountWorksheet,
  type CreditCardRow,
} from "@/lib/paymentRunApi"

export function PaymentCardsPage() {
  const month = currentMonthKey()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const deepLinkHandled = useRef(false)
  const { data: health, isPending: healthPending } = useHealth()
  const { data, isPending } = usePaymentWorksheet(month)
  const [cardSheetOpen, setCardSheetOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<CreditCardRow | null>(null)
  const [manageCardsOpen, setManageCardsOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const creditCards = data?.credit_cards ?? []
  const accountIds = useMemo(
    () => creditCards.map((row) => row.account_id),
    [creditCards],
  )
  const portfolioQueries = useCreditCardPortfolioHistories(accountIds)
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
  const historyByAccountId = useMemo(() => {
    const map = new Map(
      portfolioHistories.map((row) => [row.account.account_id, row] as const),
    )
    return map
  }, [portfolioHistories])
  const portfolioTotals = useMemo(
    () => aggregateCreditCardPortfolioTotals(portfolioHistories),
    [portfolioHistories],
  )
  const totalBalance = useMemo(
    () => sumCardBalances(creditCards.map((row) => row.owed)),
    [creditCards],
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

  async function handleCardDetailsSave(
    accountId: string,
    values: CreditCardDetailsInput,
  ) {
    setActionError(null)
    try {
      await putAccountWorksheet(accountId, month, values)
      await invalidateWorksheet()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not save card details.",
      )
      throw err
    }
  }

  function openCardSettings(row: CreditCardRow) {
    setEditingCard(row)
    setCardSheetOpen(true)
  }

  async function handleExclude(row: CreditCardRow) {
    setActionError(null)
    try {
      await putAccountWorksheet(row.account_id, month, { included: false })
      await invalidateWorksheet()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not exclude card.",
      )
    }
  }

  async function handleIncludeCard(accountId: string) {
    setActionError(null)
    try {
      await putAccountWorksheet(accountId, month, { included: true })
      await invalidateWorksheet()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not restore card."
      setActionError(message)
      throw new Error(message)
    }
  }

  function bucketLabel(bucketKey: string | null): string {
    if (!bucketKey) return "—"
    return data?.buckets.find((bucket) => bucket.id === bucketKey)?.label ?? bucketKey
  }

  const excludedCount = data?.excluded_credit_cards.length ?? 0

  useEffect(() => {
    const accountParam = searchParams.get("account")
    if (!accountParam || deepLinkHandled.current || creditCards.length === 0) {
      return
    }
    const match = creditCards.find((row) => row.account_id === accountParam)
    if (!match) return
    deepLinkHandled.current = true
    navigate(`/manage/payment-run/cards/${accountParam}`, { replace: true })
  }, [creditCards, navigate, searchParams])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Credit cards
          </h1>
          <p className="text-muted-foreground text-sm">
            Balances, activity, and worksheet settings for each card. Planned
            amounts and paid status stay on the{" "}
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
            onClick={() => setManageCardsOpen(true)}
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

      {isPending || healthPending ? (
        <Skeleton className="h-32 w-full" />
      ) : creditCards.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-8 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              No credit cards on the worksheet
            </p>
            <p>
              Credit cards load from Firefly when you refresh balances on the
              worksheet. All cards may be excluded — use Restore excluded above
              if needed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {portfolioLoading ? (
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-16 w-full" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  <MetricBlock
                    label="Total balance"
                    value={formatDisplayAmount(totalBalance)}
                  />
                  <MetricBlock
                    label="Charges"
                    value={formatDisplayAmount(portfolioTotals.charges)}
                  />
                  <MetricBlock
                    label="Fees"
                    value={formatDisplayAmount(portfolioTotals.fees)}
                  />
                  <MetricBlock
                    label="Interest"
                    value={formatDisplayAmount(portfolioTotals.interest)}
                  />
                  <MetricBlock
                    label="Payments"
                    value={formatDisplayAmount(portfolioTotals.payments)}
                  />
                  <MetricBlock
                    label="Net change"
                    value={formatDisplayAmount(portfolioTotals.net_change)}
                    hint="Charges + interest − payments"
                    valueClassName={creditCardNetChangeClassName(
                      portfolioTotals.net_change,
                    )}
                  />
                </div>
                {portfolioError ? (
                  <p className="text-muted-foreground mt-4 text-xs">
                    Some card history could not be loaded; totals may be
                    incomplete.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          )}

          <ul className="divide-y rounded-md border">
            {creditCards.map((row) => {
              const cardHistory = historyByAccountId.get(row.account_id)
              const netChange = cardHistory?.totals.net_change
              return (
              <li
                key={row.account_id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    to={`/manage/payment-run/cards/${encodeURIComponent(row.account_id)}`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {row.name ?? row.account_id}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {bucketLabel(row.funding_bucket_key)}
                    {" · "}
                    Balance {formatDisplayAmount(row.owed)}
                    {row.apr_percent ? ` · APR ${row.apr_percent}%` : ""}
                    {netChange != null ? (
                      <>
                        {" · "}
                        Net change{" "}
                        <span
                          className={creditCardNetChangeClassName(netChange)}
                        >
                          {formatDisplayAmount(netChange)}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to={`/manage/payment-run/cards/${encodeURIComponent(row.account_id)}`}
                    >
                      View
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openCardSettings(row)}
                  >
                    Edit
                  </Button>
                </div>
              </li>
              )
            })}
          </ul>
        </>
      )}

      <ManageCardsSheet
        open={manageCardsOpen}
        onOpenChange={setManageCardsOpen}
        excludedCards={data?.excluded_credit_cards ?? []}
        onInclude={handleIncludeCard}
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
