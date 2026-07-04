import { useMemo, useState } from "react"
import { ExternalLink, Plus, RefreshCw } from "lucide-react"
import {
  Link,
  Navigate,
  NavLink,
  useNavigate,
  useParams,
} from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { BillRegistrationSheet } from "@/components/payment-run/BillRegistrationSheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  registeredBillsQueryKey,
  useBillHistory,
  useRegisteredBills,
} from "@/hooks/useBillHistory"
import { useHealth } from "@/hooks/useHealth"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import {
  buildFireflyBillUrl,
  buildFireflyTransactionUrl,
} from "@/lib/fireflyLinks"
import { formatDisplayAmount, formatDisplayDate } from "@/lib/formatDisplay"
import {
  currentMonthKey,
  fetchAvailableBills,
  registerBill,
  type AvailableFireflyBill,
  type BillHistoryTransaction,
  type RegisterBillPayload,
  type RegisteredBillListItem,
} from "@/lib/paymentRunApi"

function MetricBlock({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-2xl font-bold leading-tight tracking-tight tabular-nums sm:text-[28px]">
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function formatWindowCaption(window: { start: string; end: string }): string {
  const startDate = new Date(window.start)
  const endDate = new Date(window.end)
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

function sectionBadgeVariant(section: string): "secondary" | "outline" {
  return section === "liabilities" ? "outline" : "secondary"
}

function sectionBadgeLabel(section: string): string {
  return section === "liabilities" ? "Liabilities" : "Bills"
}

function BillPickerList({
  bills,
  loading,
  error,
  onRetry,
  onLinkExisting,
  onRegisterNew,
}: {
  bills: RegisteredBillListItem[]
  loading: boolean
  error: boolean
  onRetry: () => void
  onLinkExisting: () => void
  onRegisterNew: () => void
}) {
  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-3 space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-card p-4 space-y-3">
        <p className="text-destructive text-sm">
          Could not load registered bills. Try again.
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }

  if (bills.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center space-y-3">
        <p className="font-medium">No bills registered yet</p>
        <p className="text-muted-foreground text-sm">
          Link a bill that already exists in Firefly, or register a new one, to
          see payment history here.
        </p>
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Button type="button" onClick={onLinkExisting}>
            Link existing bill
          </Button>
          <Button type="button" variant="outline" onClick={onRegisterNew}>
            Register new bill
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          Or{" "}
          <Link
            to="/manage/payment-run/discover"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            find recurring bills
          </Link>{" "}
          from withdrawal history.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card max-h-[calc(100vh-12rem)] overflow-y-auto lg:max-h-[calc(100vh-12rem)] max-lg:max-h-64">
      <ul>
        {bills.map((bill) => (
          <li key={bill.registry_id}>
            <NavLink
              to={`/manage/bills/${bill.registry_id}`}
              className={({ isActive }) =>
                [
                  "flex min-h-[44px] items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium hover:bg-muted/50",
                  isActive ? "bg-muted font-semibold" : "",
                ].join(" ")
              }
            >
              <span className="truncate">{bill.row_label ?? "Unnamed bill"}</span>
              <Badge variant={sectionBadgeVariant(bill.worksheet_section)}>
                {sectionBadgeLabel(bill.worksheet_section)}
              </Badge>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

function BillTransactionTable({
  transactions,
  fireflyBaseUrl,
}: {
  transactions: BillHistoryTransaction[]
  fireflyBaseUrl?: string
}) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-md border p-6 space-y-2">
        <p className="font-medium">No payments in this period</p>
        <p className="text-muted-foreground text-sm">
          No payments linked to this bill in the last 12 months. Check that
          import rules attach withdrawals in Firefly, or open the bill in
          Firefly to review links.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <div className="px-4 py-2.5">
        <table className="w-full min-w-[24rem] table-fixed text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:py-1 [&_th]:py-1">
          <colgroup>
            <col style={{ width: "5.5rem" }} />
            <col style={{ width: "8rem" }} />
            <col style={{ width: "8rem" }} />
            <col style={{ width: "5.5rem" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="pr-3 text-left whitespace-nowrap">Date</th>
              <th className="pr-3 text-left">Description</th>
              <th className="pr-3 text-left">Payee</th>
              <th className="text-right whitespace-nowrap">Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn, index) => {
              const fireflyUrl = buildFireflyTransactionUrl(
                fireflyBaseUrl,
                txn.journal_id,
              )
              const rowKey = `${txn.date}-${txn.journal_id ?? index}`
              return (
                <tr key={rowKey} className="border-t border-border/40">
                  <td className="pr-3 tabular-nums whitespace-nowrap">
                    {formatDisplayDate(txn.date)}
                  </td>
                  <td className="pr-3 truncate">
                    {fireflyUrl ? (
                      <a
                        href={fireflyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary block truncate underline-offset-2 hover:underline"
                        title={txn.description ?? undefined}
                      >
                        {txn.description ?? "—"}
                      </a>
                    ) : (
                      <span
                        className="block truncate"
                        title={txn.description ?? undefined}
                      >
                        {txn.description ?? "—"}
                      </span>
                    )}
                  </td>
                  <td
                    className="text-muted-foreground pr-3 truncate"
                    title={txn.payee ?? undefined}
                  >
                    {txn.payee ?? "—"}
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap">
                    {formatDisplayAmount(txn.amount)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BillDetailPanel({
  registryId,
  bills,
  billsLoaded,
}: {
  registryId: string | undefined
  bills: RegisteredBillListItem[]
  billsLoaded: boolean
}) {
  const parsedId =
    registryId != null ? Number.parseInt(registryId, 10) : Number.NaN
  const validId = Number.isFinite(parsedId) ? parsedId : null
  const selectedBill =
    validId != null
      ? bills.find((bill) => bill.registry_id === validId)
      : undefined

  const historyEnabled =
    validId != null && (!billsLoaded || selectedBill != null)
  const {
    data: history,
    isPending: historyPending,
    isError: historyError,
    refetch: refetchHistory,
  } = useBillHistory(historyEnabled ? validId : null)

  if (!registryId) {
    if (bills.length > 0) {
      return (
        <p className="text-muted-foreground text-sm">
          Select a bill to view its payment history.
        </p>
      )
    }
    return null
  }

  if (billsLoaded && validId != null && !selectedBill) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-card p-4 space-y-2">
        <p className="text-destructive text-sm">
          This bill is no longer registered or was removed from Firefly. Return
          to the list or update registration on the payment worksheet.
        </p>
      </div>
    )
  }

  const fireflyBaseUrl = history?.firefly_base_url
  const billUrl = buildFireflyBillUrl(
    fireflyBaseUrl,
    history?.firefly_bill_id ?? selectedBill?.firefly_bill_id,
  )

  return (
    <div className="space-y-4">
      {historyPending && (
        <>
          <Skeleton className="h-8 w-48" />
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        </>
      )}

      {historyError && (
        <div className="rounded-lg border border-destructive/50 bg-card p-4 space-y-3">
          <p className="text-destructive text-sm">
            Could not load bill history. Try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetchHistory()}>
            Try again
          </Button>
        </div>
      )}

      {!historyPending && !historyError && history && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">
              {history.row_label ?? selectedBill?.row_label ?? "Bill"}
            </h2>
            {billUrl ? (
              <Button asChild variant="link" size="sm" className="h-auto px-0">
                <a href={billUrl} target="_blank" rel="noopener noreferrer">
                  Open in Firefly
                  <ExternalLink className="ml-1 size-3.5" />
                </a>
              </Button>
            ) : null}
          </div>

          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                <MetricBlock
                  label="12-month total"
                  value={formatDisplayAmount(history.total)}
                />
                <MetricBlock
                  label="Calendar average"
                  value={formatDisplayAmount(history.calendar_average)}
                  hint="Rolling 12 months ÷ 12 (drops oldest month)"
                />
                <MetricBlock
                  label="Active-month average"
                  value={formatDisplayAmount(history.active_month_average)}
                  hint={
                    history.active_month_count > 0
                      ? `Avg of ${history.active_month_count} months with payments`
                      : "No months with payments"
                  }
                />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Linked payments</h3>
            <BillTransactionTable
              transactions={history.transactions}
              fireflyBaseUrl={fireflyBaseUrl}
            />
          </div>
        </>
      )}
    </div>
  )
}

export function BillsDetailPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const month = currentMonthKey()
  const { registryId } = useParams<{ registryId?: string }>()
  const { data: health, isPending: healthPending } = useHealth()
  const { data: worksheetData } = usePaymentWorksheet(month)
  const {
    data: billsData,
    isPending: billsPending,
    isFetching: billsFetching,
    isError: billsError,
    refetch: refetchBills,
  } = useRegisteredBills()
  const refreshing = billsFetching && !billsPending

  const [billRegistrationOpen, setBillRegistrationOpen] = useState(false)
  const [billRegistrationMode, setBillRegistrationMode] = useState<
    "create_new" | "link_existing"
  >("link_existing")
  const [availableBills, setAvailableBills] = useState<AvailableFireflyBill[]>(
    [],
  )
  const [loadingAvailableBills, setLoadingAvailableBills] = useState(false)

  const bills = useMemo(() => {
    const rows = billsData?.data ?? []
    return [...rows].sort((a, b) =>
      (a.row_label ?? "").localeCompare(b.row_label ?? "", undefined, {
        sensitivity: "base",
      }),
    )
  }, [billsData])

  async function openBillRegistration(
    mode: "create_new" | "link_existing",
  ) {
    setBillRegistrationMode(mode)
    setBillRegistrationOpen(true)
    setLoadingAvailableBills(true)
    try {
      const { data } = await fetchAvailableBills()
      setAvailableBills(data)
    } catch {
      setAvailableBills([])
    } finally {
      setLoadingAvailableBills(false)
    }
  }

  async function handleRegisterBill(payload: RegisterBillPayload) {
    const result = await registerBill(payload)
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
    await queryClient.invalidateQueries({ queryKey: registeredBillsQueryKey() })
    setBillRegistrationOpen(false)
    toast.success(`${payload.name} registered`, { duration: 4000 })
    if (result.id) {
      navigate(`/manage/bills/${result.id}`)
    } else {
      await refetchBills()
    }
  }

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  if (!registryId && !billsPending && bills.length > 0) {
    return <Navigate to={`/manage/bills/${bills[0].registry_id}`} replace />
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Bill history</h1>
          <p className="text-muted-foreground text-sm">
            Last 12 months of payments for bills registered on your payment
            worksheet. Link or register bills here to start tracking history.
          </p>
          {registryId ? (
            <BillWindowCaption registryId={registryId} />
          ) : null}
        </div>
        {!billsPending ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void openBillRegistration("link_existing")}
            >
              <Plus className="mr-2 size-4" />
              Link existing bill
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void openBillRegistration("create_new")}
            >
              Register new bill
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-[7.5rem]"
              onClick={() => void refetchBills()}
              disabled={refreshing}
            >
              <RefreshCw
                className={
                  refreshing ? "mr-2 size-4 animate-spin" : "mr-2 size-4"
                }
              />
              Refresh
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(240px,280px)_1fr] lg:gap-6">
        <BillPickerList
          bills={bills}
          loading={billsPending}
          error={billsError}
          onRetry={() => refetchBills()}
          onLinkExisting={() => void openBillRegistration("link_existing")}
          onRegisterNew={() => void openBillRegistration("create_new")}
        />
        <BillDetailPanel
          registryId={registryId}
          bills={bills}
          billsLoaded={!billsPending}
        />
      </div>

      <BillRegistrationSheet
        open={billRegistrationOpen}
        onOpenChange={setBillRegistrationOpen}
        defaultSection="bills"
        initialMode={billRegistrationMode}
        creditCards={worksheetData?.credit_cards ?? []}
        buckets={worksheetData?.buckets ?? []}
        availableBills={availableBills}
        loadingAvailable={loadingAvailableBills}
        onSubmit={handleRegisterBill}
      />
    </div>
  )
}

function BillWindowCaption({ registryId }: { registryId: string }) {
  const parsedId = Number.parseInt(registryId, 10)
  const validId = Number.isFinite(parsedId) ? parsedId : null
  const { data: history } = useBillHistory(validId)

  if (!history?.window) {
    return null
  }

  return (
    <p className="text-muted-foreground text-sm">
      {formatWindowCaption(history.window)}
    </p>
  )
}
