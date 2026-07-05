import { useEffect, useState } from "react"
import { Link, Navigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { BillRegistrationSheet } from "@/components/payment-run/BillRegistrationSheet"
import { BillSuggestionBucketSection } from "@/components/payment-run/BillSuggestionBucketSection"
import { DiscoverIgnoredCategories } from "@/components/payment-run/DiscoverIgnoredCategories"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { registeredBillsQueryKey } from "@/hooks/useBillHistory"
import { useBillSuggestions } from "@/hooks/useBillSuggestions"
import { useDiscoverSettings } from "@/hooks/useDiscoverSettings"
import { useHealth } from "@/hooks/useHealth"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import {
  LOOKBACK_CHOICES,
  groupByPayee,
  orderedPayeeKeys,
  parseLookback,
} from "@/lib/billDiscoverUtils"
import {
  billGroupsQueryKey,
  currentMonthKey,
  fetchAvailableBills,
  registerBill,
  type AvailableFireflyBill,
  type BillSuggestion,
  type RegisterBillPayload,
} from "@/lib/paymentRunApi"
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

function parseLocalDate(isoDateOnly: string): Date {
  const [year, month, day] = isoDateOnly.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function formatWindowCaption(start: string, end: string): string {
  const startDate = parseLocalDate(start)
  const endDate = parseLocalDate(end)
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
  const queryClient = useQueryClient()
  const month = currentMonthKey()
  const { data: health, isPending: healthPending } = useHealth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [hideReview, setHideReview] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] =
    useState<BillSuggestion | null>(null)
  const [availableBills, setAvailableBills] = useState<AvailableFireflyBill[]>(
    [],
  )
  const [loadingAvailableBills, setLoadingAvailableBills] = useState(false)

  const rawLookback = searchParams.get("lookback")
  const lookbackMonths = parseLookback(rawLookback)

  useEffect(() => {
    if (rawLookback != null && rawLookback !== String(lookbackMonths)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set("lookback", String(lookbackMonths))
          return next
        },
        { replace: true },
      )
    }
  }, [rawLookback, lookbackMonths, setSearchParams])

  useEffect(() => {
    setExpandedIds(new Set())
    queryClient.removeQueries({
      queryKey: ["paymentRun", "billSuggestionTransactions"],
    })
  }, [lookbackMonths, queryClient])

  const { data: discoverSettings } = useDiscoverSettings()

  useEffect(() => {
    setExpandedIds(new Set())
    queryClient.removeQueries({
      queryKey: ["paymentRun", "billSuggestionTransactions"],
    })
  }, [discoverSettings?.ignored_categories, queryClient])

  const {
    data,
    isPending,
    isFetching,
    isError,
    refetch,
  } = useBillSuggestions(lookbackMonths)
  const { data: worksheetData } = usePaymentWorksheet(month)

  const grouped =
    data && !isError ? groupByPayee(data.data, hideReview) : new Map()
  const visibleSuggestionCount =
    data && !isError
      ? data.data.filter((s) => !hideReview || s.status !== "review").length
      : 0

  async function handleAdoptSubmit(payload: RegisterBillPayload) {
    if (!selectedSuggestion) return
    const merchant = selectedSuggestion.merchant
    await registerBill(payload)
    try {
      await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
      await queryClient.invalidateQueries({ queryKey: registeredBillsQueryKey() })
      await queryClient.invalidateQueries({ queryKey: billGroupsQueryKey() })
      await refetch()
    } catch {
      // Registration succeeded; refresh failure should not block success UX
      void queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
      void queryClient.invalidateQueries({ queryKey: registeredBillsQueryKey() })
      void queryClient.invalidateQueries({ queryKey: billGroupsQueryKey() })
      void refetch()
    }
    setSheetOpen(false)
    toast.success(`${merchant} registered`, { duration: 4000 })
  }

  async function openAdopt(suggestion: BillSuggestion) {
    setSelectedSuggestion(suggestion)
    setSheetOpen(true)
    setLoadingAvailableBills(true)
    try {
      const { data: bills } = await fetchAvailableBills()
      setAvailableBills(bills)
    } catch {
      setAvailableBills([])
    } finally {
      setLoadingAvailableBills(false)
    }
  }

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

  function handleToggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleRefresh() {
    setExpandedIds(new Set())
    queryClient.removeQueries({
      queryKey: ["paymentRun", "billSuggestionTransactions"],
    })
    void refetch()
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
                value={`${visibleSuggestionCount} suggestions`}
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
              onClick={handleRefresh}
            >
              <RefreshCw
                className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")}
              />
              {isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          <DiscoverIgnoredCategories lookbackMonths={lookbackMonths} />
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

        {!loading && !isError && data && data.data.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 p-8 text-center">
              <p className="font-medium">No new bill suggestions</p>
              <p className="text-muted-foreground text-sm">
                We didn&apos;t find recurring charges to register in this lookback
                window. Your worksheet and registered bills are up to date.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button asChild variant="default">
                  <Link to="/manage/payment-run">Open payment worksheet</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/manage/bills">View registered bills</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !isError && data && data.data.length > 0 ? (
          <div className="space-y-8">
            {orderedPayeeKeys(grouped).map((payeeName) => {
              const rows = grouped.get(payeeName)
              if (!rows?.length) return null
              return (
                <BillSuggestionBucketSection
                  key={payeeName}
                  payeeName={payeeName}
                  rows={rows}
                  onAdopt={(row) => void openAdopt(row)}
                  expandedIds={expandedIds}
                  onToggleExpanded={handleToggleExpanded}
                  lookbackMonths={lookbackMonths}
                />
              )
            })}
          </div>
        ) : null}
      </div>

      <BillRegistrationSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) {
            setSelectedSuggestion(null)
          }
        }}
        initialPrefill={selectedSuggestion?.register_prefill ?? null}
        paymentSourceHint={selectedSuggestion?.payment_source ?? null}
        creditCards={worksheetData?.credit_cards ?? []}
        buckets={worksheetData?.buckets ?? []}
        availableBills={availableBills}
        loadingAvailable={loadingAvailableBills}
        onSubmit={handleAdoptSubmit}
      />
    </div>
  )
}
