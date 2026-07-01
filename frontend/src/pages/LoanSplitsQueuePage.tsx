import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { FireflyTransactionLink } from "@/components/FireflyTransactionLink"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDateRange } from "@/context/DateRangeContext"
import { useLoanSplitsQueue } from "@/hooks/useLoanSplitsQueue"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import {
  applyLoanSplit,
  type PendingLoanSplit,
  type SplitAmounts,
} from "@/lib/loanApi"
import { invalidateReportCaches } from "@/lib/reportCache"

type AmountState = Record<string, SplitAmounts>

export function LoanSplitsQueuePage() {
  const queryClient = useQueryClient()
  const { committedRange } = useDateRange()
  const { data, isPending, isError } = useLoanSplitsQueue(
    committedRange.start,
    committedRange.end,
  )
  const { data: normalizedData } = useNormalizedTransactions(
    committedRange.start,
    committedRange.end,
  )
  const fireflyBaseUrl = normalizedData?.firefly_base_url
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [amounts, setAmounts] = useState<AmountState>({})
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const visible = useMemo(() => {
    const rows = data?.data ?? []
    return rows.filter((r) => !dismissed.has(r.journal_id))
  }, [data?.data, dismissed])

  function getAmounts(row: PendingLoanSplit): SplitAmounts {
    return (
      amounts[row.journal_id] ?? {
        principal: row.preview.principal,
        interest: row.preview.interest,
        escrow: row.preview.escrow,
      }
    )
  }

  function updateAmount(
    row: PendingLoanSplit,
    field: keyof SplitAmounts,
    value: string,
  ) {
    setAmounts((prev) => ({
      ...prev,
      [row.journal_id]: { ...getAmounts(row), [field]: value },
    }))
  }

  async function handleApply(row: PendingLoanSplit) {
    const splitAmounts = getAmounts(row)
    setApplyingId(row.journal_id)
    setErrors((prev) => {
      const next = { ...prev }
      delete next[row.journal_id]
      return next
    })
    try {
      await applyLoanSplit(row.journal_id, {
        transaction_journal_id: row.transaction_journal_id,
        principal: splitAmounts.principal,
        interest: splitAmounts.interest,
        escrow: splitAmounts.escrow,
        start: committedRange.start,
        end: committedRange.end,
      })
      setDismissed((prev) => new Set(prev).add(row.journal_id))
      await Promise.all([
        invalidateReportCaches(queryClient),
        queryClient.invalidateQueries({ queryKey: ["loanSplitsQueue"] }),
      ])
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [row.journal_id]:
          err instanceof Error ? err.message : "Apply failed. Try again.",
      }))
    } finally {
      setApplyingId(null)
    }
  }

  function handleSkip(journalId: string) {
    setDismissed((prev) => new Set(prev).add(journalId))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Loan splits</h1>
          <p className="text-muted-foreground text-sm">
            {visible.length} pending payment{visible.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/manage/loans">Configure profiles</Link>
        </Button>
      </div>
      <div>
        {data?.meta.forward_only_since && (
          <p className="text-muted-foreground mt-2 text-xs">
            Showing payments on or after {data.meta.forward_only_since} (forward-only)
          </p>
        )}
      </div>

      {isPending && <Skeleton className="h-32 w-full" />}
      {isError && (
        <p className="text-destructive text-sm">Failed to load loan split queue.</p>
      )}

      {!isPending && !isError && visible.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground space-y-2 py-8 text-sm">
            <p>No loan payments matched your profile in this date range.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Widen the global date range to include the payment date
              </li>
              <li>
                Confirm <code className="text-xs">FF3ANALYTICS_LOAN_SPLITS_SINCE</code>{" "}
                in <code className="text-xs">.env</code> is on or before the payment
              </li>
              <li>
                Profile must be <strong>Enabled</strong>; payment must still be a{" "}
                <strong>single split</strong> (not already split)
              </li>
              <li>
                Match <strong>transaction type</strong> (transfer vs withdrawal) and{" "}
                <strong>description contains</strong> to what Transaction Explorer shows
              </li>
              <li>
                <strong>Expected amount</strong> must be within tolerance of the payment
                total
              </li>
            </ul>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link to="/manage/loans">Configure profiles</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {visible.map((row) => {
          const splitAmounts = getAmounts(row)
          return (
            <Card key={row.journal_id}>
              <CardHeader className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{row.description}</span>
                  <div className="flex items-center gap-3">
                    <FireflyTransactionLink
                      fireflyBaseUrl={fireflyBaseUrl}
                      journalId={row.journal_id}
                    />
                    <span className="font-medium">{row.amount}</span>
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">{row.date}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  {(["principal", "interest", "escrow"] as const).map((field) => (
                    <label key={field} className="space-y-1 text-sm">
                      <span className="capitalize">{field}</span>
                      <input
                        className="border-input w-full rounded-md border px-3 py-2"
                        value={splitAmounts[field]}
                        onChange={(e) =>
                          updateAmount(row, field, e.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  Override amounts to match your lender statement before applying.
                </p>
                {row.warning && (
                  <Badge className="bg-amber-100 text-amber-800">
                    Amount outside tolerance
                  </Badge>
                )}
                {errors[row.journal_id] && (
                  <p className="text-destructive text-sm">{errors[row.journal_id]}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleApply(row)}
                    disabled={applyingId === row.journal_id}
                  >
                    Apply split
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleSkip(row.journal_id)}
                  >
                    Skip
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
