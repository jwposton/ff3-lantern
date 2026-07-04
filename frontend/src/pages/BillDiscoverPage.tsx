import { useState } from "react"
import { Link, Navigate, useSearchParams } from "react-router-dom"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useBillSuggestions } from "@/hooks/useBillSuggestions"
import { useHealth } from "@/hooks/useHealth"
import { LOOKBACK_CHOICES, parseLookback } from "@/lib/billDiscoverUtils"
import { cn } from "@/lib/utils"

const selectClassName =
  "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"

function MetricBlock({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-2xl font-bold leading-tight tracking-tight tabular-nums sm:text-[28px]">
        {value}
      </p>
    </div>
  )
}

function formatWindowCaption(start: string, end: string): string {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const startPart = startDate.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  })
  const endPart = endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return `${startPart} – ${endPart}`
}

export function BillDiscoverPage() {
  const { data: health, isPending: healthPending } = useHealth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [hideReview, setHideReview] = useState(false)

  const lookbackMonths = parseLookback(searchParams.get("lookback"))
  const {
    data,
    isPending,
    isFetching,
    isError,
    refetch,
  } = useBillSuggestions(lookbackMonths)

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  const loading = isPending || healthPending

  function handleLookbackChange(nextMonths: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set("lookback", String(nextMonths))
      return next
    })
  }

  return (
    <div className="space-y-4 px-6 pt-6 pb-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Link
            to="/manage/payment-run"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Payment Worksheet
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Bill discover</h1>
        </div>
      </div>

      <Card className="rounded-lg border bg-card">
        <CardContent className="space-y-4 p-4">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : data ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <MetricBlock
                label="Withdrawals analyzed"
                value={`${data.meta.withdrawals_analyzed.toLocaleString()} withdrawals analyzed`}
              />
              <MetricBlock
                label="Period"
                value={formatWindowCaption(
                  data.meta.period_start,
                  data.meta.period_end,
                )}
              />
              <MetricBlock
                label="Suggestions"
                value={`${data.meta.suggestions_count} suggestions`}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <label htmlFor="discover-lookback" className="sr-only">
              Lookback
            </label>
            <select
              id="discover-lookback"
              className={cn(selectClassName, "w-auto min-w-[9rem]")}
              value={lookbackMonths}
              onChange={(event) =>
                handleLookbackChange(Number(event.target.value))
              }
            >
              {LOOKBACK_CHOICES.map((months) => (
                <option key={months} value={months}>
                  {months} months
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={hideReview}
              onClick={() => setHideReview((prev) => !prev)}
            >
              {hideReview ? "Showing all" : "Hide review"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => refetch()}
            >
              <RefreshCw
                className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")}
              />
              {isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div
        aria-label="Bill discover content"
        aria-busy={loading ? "true" : undefined}
        className="space-y-4"
      >
        {loading ? (
          <>
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="space-y-3 p-4">
                  <Skeleton className="h-32 w-full" />
                  <Skeleton className="h-48 w-full" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : null}

        {!loading && isError ? (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <p className="text-destructive text-sm">
                Could not load bill suggestions.
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

        {!loading && !isError && data ? (
          /* Bucket tables ship in Plan 02 */
          null
        ) : null}
      </div>
    </div>
  )
}
