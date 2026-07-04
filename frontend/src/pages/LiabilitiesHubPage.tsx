import { useMemo, useState } from "react"
import { Link, Navigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { LiabilityAccountSheet } from "@/components/payment-run/LiabilityAccountSheet"
import type { LiabilityAccountDetailsInput } from "@/components/payment-run/LiabilityAccountSheet"
import { ManageLiabilitiesSheet } from "@/components/payment-run/ManageLiabilitiesSheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useHealth } from "@/hooks/useHealth"
import { useLoans } from "@/hooks/useLoans"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import {
  currentMonthKey,
  putAccountWorksheet,
  type LiabilityRow,
} from "@/lib/paymentRunApi"

export function LiabilitiesHubPage() {
  const month = currentMonthKey()
  const queryClient = useQueryClient()
  const { data: health, isPending: healthPending } = useHealth()
  const { data, isPending } = usePaymentWorksheet(month)
  const { data: loansData, isPending: loansPending } = useLoans()
  const [liabilitySheetOpen, setLiabilitySheetOpen] = useState(false)
  const [editingLiability, setEditingLiability] = useState<LiabilityRow | null>(
    null,
  )
  const [manageLiabilitiesOpen, setManageLiabilitiesOpen] = useState(false)

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
    await putAccountWorksheet(accountId, month, values)
    await invalidateWorksheet()
  }

  async function handleExcludeLiability(row: LiabilityRow) {
    if (!row.account_id) return
    await putAccountWorksheet(row.account_id, month, { included: false })
    await invalidateWorksheet()
  }

  async function handleIncludeLiability(accountId: string) {
    await putAccountWorksheet(accountId, month, { included: true })
    await invalidateWorksheet()
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Liabilities
          </h1>
          <p className="text-muted-foreground text-sm">
            Firefly liability accounts on the worksheet. Loan profiles drive
            auto-draft planned amounts and payment splits.
          </p>
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
                <div className="space-y-1">
                  <p className="font-medium">{row.name ?? accountId}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={configured ? "default" : "secondary"}>
                      {configured ? "Loan configured" : "Not configured"}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {bucketLabel(row.funding_bucket_key)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
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
