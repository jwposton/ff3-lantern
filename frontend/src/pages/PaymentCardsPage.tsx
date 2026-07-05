import { useEffect, useRef, useState } from "react"
import { Link, Navigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { CreditCardSheet } from "@/components/payment-run/CreditCardSheet"
import type { CreditCardDetailsInput } from "@/components/payment-run/CreditCardSheet"
import { ManageCardsSheet } from "@/components/payment-run/ManageCardsSheet"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useHealth } from "@/hooks/useHealth"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import {
  currentMonthKey,
  putAccountWorksheet,
  type CreditCardRow,
} from "@/lib/paymentRunApi"

export function PaymentCardsPage() {
  const month = currentMonthKey()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const deepLinkHandled = useRef(false)
  const { data: health, isPending: healthPending } = useHealth()
  const { data, isPending } = usePaymentWorksheet(month)
  const [cardSheetOpen, setCardSheetOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<CreditCardRow | null>(null)
  const [manageCardsOpen, setManageCardsOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  function openCardDetails(row: CreditCardRow) {
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

  const creditCards = data?.credit_cards ?? []
  const excludedCount = data?.excluded_credit_cards.length ?? 0

  useEffect(() => {
    const accountParam = searchParams.get("account")
    if (!accountParam || deepLinkHandled.current || creditCards.length === 0) return
    const match = creditCards.find((row) => row.account_id === accountParam)
    if (!match) return
    deepLinkHandled.current = true
    openCardDetails(match)
  }, [creditCards, searchParams])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Credit cards
          </h1>
          <p className="text-muted-foreground text-sm">
            Edit cash account, limits, and defaults for cards on the worksheet.
            Planned amounts and paid status stay on the{" "}
            <Link
              to="/manage/payment-run"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              payment worksheet
            </Link>
            .
          </p>
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
              payment worksheet. All cards may be excluded — use Restore
              excluded above if needed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-md border">
          {creditCards.map((row) => (
            <li
              key={row.account_id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">{row.name ?? row.account_id}</p>
                <p className="text-muted-foreground text-xs">
                  {bucketLabel(row.funding_bucket_key)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openCardDetails(row)}
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
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
