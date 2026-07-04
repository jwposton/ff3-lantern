import { ChevronDown, ChevronRight } from "lucide-react"
import { Fragment } from "react"

import {
  BillSuggestionTransactionsPanel,
  useBillSuggestionRowDrilldown,
} from "@/components/payment-run/BillSuggestionTransactionsPanel"
import { COMPACT_TABLE } from "@/components/payment-run/worksheetTableUtils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDisplayAmount, formatDisplayDate } from "@/lib/formatDisplay"
import type { BillSuggestion } from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

const DESKTOP_COLUMN_COUNT = 11

export function confidenceBadgeClass(
  confidence: BillSuggestion["confidence"],
): string {
  if (confidence === "high") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
  }
  if (confidence === "medium") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
  }
  return "bg-muted text-muted-foreground"
}

function capitalizeLabel(value: string): string {
  if (!value) return "—"
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function billColumnDetail(row: BillSuggestion): string | null {
  const payee = (
    row.payee?.trim() ||
    row.register_prefill.destination_account?.trim() ||
    row.bucket?.trim() ||
    ""
  )
  const category = typeof row.category === "string" ? row.category.trim() : ""
  const parts: string[] = []

  if (category) {
    const merchantBase = row.merchant
      .replace(/ \(likely\)$/, "")
      .replace(/ \(misc\)$/, "")
    if (category.toLowerCase() !== merchantBase.toLowerCase()) {
      parts.push(category)
    }
  }
  if (payee) {
    parts.push(`Payee: ${payee}`)
  }

  return parts.length ? parts.join(" · ") : null
}

/** @deprecated Use billColumnDetail */
export function billColumnSubtitle(row: BillSuggestion): string | null {
  return billColumnDetail(row)
}

function reviewHighlightClass(row: BillSuggestion): string {
  if (row.status === "review" || (row.notes && !row.cluster)) {
    return "border-l-4 border-l-amber-500/70 bg-amber-50/40 dark:bg-amber-950/20"
  }
  return ""
}

type BillSuggestionBucketSectionProps = {
  payeeName: string
  rows: BillSuggestion[]
  onAdopt: (row: BillSuggestion) => void
  expandedIds: Set<string>
  onToggleExpanded: (id: string) => void
  lookbackMonths: number
}

function DesktopExpandChevron({
  row,
  isExpanded,
  onToggleExpanded,
  lookbackMonths,
}: {
  row: BillSuggestion
  isExpanded: boolean
  onToggleExpanded: (id: string) => void
  lookbackMonths: number
}) {
  const { isFetching } = useBillSuggestionRowDrilldown(
    row.id,
    lookbackMonths,
    isExpanded,
  )
  const panelId = `discover-txn-panel-${row.id}`
  const disabled = isExpanded && isFetching

  if (row.occurrences === 0) {
    return null
  }

  return (
    <button
      type="button"
      className={cn(
        "text-muted-foreground hover:text-foreground rounded p-0.5",
        disabled && "cursor-not-allowed opacity-50",
      )}
      aria-expanded={isExpanded}
      aria-controls={panelId}
      aria-disabled={disabled ? "true" : undefined}
      aria-label={
        isExpanded
          ? `Hide withdrawals for ${row.merchant}`
          : `Show withdrawals for ${row.merchant}`
      }
      disabled={disabled}
      onClick={() => onToggleExpanded(row.id)}
    >
      {isExpanded ? (
        <ChevronDown className="size-3.5" aria-hidden />
      ) : (
        <ChevronRight className="size-3.5" aria-hidden />
      )}
    </button>
  )
}

function MobileExpandChevron({
  row,
  isExpanded,
  onToggleExpanded,
  lookbackMonths,
}: {
  row: BillSuggestion
  isExpanded: boolean
  onToggleExpanded: (id: string) => void
  lookbackMonths: number
}) {
  const { isFetching } = useBillSuggestionRowDrilldown(
    row.id,
    lookbackMonths,
    isExpanded,
  )
  const panelId = `discover-txn-panel-${row.id}`
  const disabled = isExpanded && isFetching

  if (row.occurrences === 0) {
    return <span className="min-h-[44px] min-w-[44px] shrink-0" aria-hidden />
  }

  return (
    <button
      type="button"
      className={cn(
        "text-muted-foreground hover:text-foreground flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded",
        disabled && "cursor-not-allowed opacity-50",
      )}
      aria-expanded={isExpanded}
      aria-controls={panelId}
      aria-disabled={disabled ? "true" : undefined}
      aria-label={
        isExpanded
          ? `Hide withdrawals for ${row.merchant}`
          : `Show withdrawals for ${row.merchant}`
      }
      disabled={disabled}
      onClick={() => onToggleExpanded(row.id)}
    >
      {isExpanded ? (
        <ChevronDown className="size-3.5" aria-hidden />
      ) : (
        <ChevronRight className="size-3.5" aria-hidden />
      )}
    </button>
  )
}

export function BillSuggestionBucketSection({
  payeeName,
  rows,
  onAdopt,
  expandedIds,
  onToggleExpanded,
  lookbackMonths,
}: BillSuggestionBucketSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h2 className="text-xl font-semibold">
          {payeeName} ({rows.length})
        </h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="hidden overflow-x-auto rounded-md border sm:block">
          <Table className={COMPACT_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 p-0 text-center" />
                <TableHead className="min-w-[8rem]">Bill</TableHead>
                <TableHead className="w-[4.5rem] text-right">Min</TableHead>
                <TableHead className="w-[4.5rem] text-right">Avg</TableHead>
                <TableHead className="w-[4.5rem] text-right">Max</TableHead>
                <TableHead className="w-[4rem]">Freq</TableHead>
                <TableHead className="w-[3rem] text-right">Hits</TableHead>
                <TableHead className="min-w-[5rem]">Paid via</TableHead>
                <TableHead className="w-[5.5rem]">Confidence</TableHead>
                <TableHead className="w-[5.5rem]">Last</TableHead>
                <TableHead className="w-[4.5rem]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const detail = billColumnDetail(row)
                const isExpanded = expandedIds.has(row.id)
                return (
                  <Fragment key={row.id}>
                    <TableRow className={cn(reviewHighlightClass(row))}>
                      <TableCell className="w-8 p-0 text-center">
                        <DesktopExpandChevron
                          row={row}
                          isExpanded={isExpanded}
                          onToggleExpanded={onToggleExpanded}
                          lookbackMonths={lookbackMonths}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{row.merchant}</div>
                        {detail ? (
                          <p className="text-xs text-muted-foreground">
                            {detail}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatDisplayAmount(row.amount_min)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatDisplayAmount(row.amount_avg)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatDisplayAmount(row.amount_max)}
                      </TableCell>
                      <TableCell>{capitalizeLabel(row.freq)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.occurrences}
                      </TableCell>
                      <TableCell
                        className="max-w-[8rem] truncate"
                        title={row.payment_source}
                      >
                        {row.payment_source}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-transparent font-normal",
                            confidenceBadgeClass(row.confidence),
                          )}
                        >
                          {capitalizeLabel(row.confidence)}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDisplayDate(row.last_date)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          aria-label={`Adopt ${row.merchant} as bill`}
                          onClick={() => onAdopt(row)}
                        >
                          Adopt
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isExpanded ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={DESKTOP_COLUMN_COUNT}
                          className="p-0"
                        >
                          <BillSuggestionTransactionsPanel
                            suggestionId={row.id}
                            merchant={row.merchant}
                            lookbackMonths={lookbackMonths}
                            isExpanded={isExpanded}
                            occurrences={row.occurrences}
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3 sm:hidden">
          {rows.map((row) => {
            const detail = billColumnDetail(row)
            const isExpanded = expandedIds.has(row.id)
            return (
              <div
                key={row.id}
                className={cn(
                  "space-y-2 rounded-md border p-3",
                  reviewHighlightClass(row),
                )}
              >
                <div className="flex items-start gap-2">
                  <MobileExpandChevron
                    row={row}
                    isExpanded={isExpanded}
                    onToggleExpanded={onToggleExpanded}
                    lookbackMonths={lookbackMonths}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{row.merchant}</p>
                    {detail ? (
                      <p className="text-xs text-muted-foreground">{detail}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
                  <span>Min {formatDisplayAmount(row.amount_min)}</span>
                  <span>Avg {formatDisplayAmount(row.amount_avg)}</span>
                  <span>Max {formatDisplayAmount(row.amount_max)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {capitalizeLabel(row.freq)} · {row.occurrences} hits ·{" "}
                  <span title={row.payment_source}>{row.payment_source}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-transparent font-normal",
                      confidenceBadgeClass(row.confidence),
                    )}
                  >
                    {capitalizeLabel(row.confidence)}
                  </Badge>
                  <span className="tabular-nums text-muted-foreground">
                    Last {formatDisplayDate(row.last_date)}
                  </span>
                </div>
                {isExpanded ? (
                  <BillSuggestionTransactionsPanel
                    suggestionId={row.id}
                    merchant={row.merchant}
                    lookbackMonths={lookbackMonths}
                    isExpanded={isExpanded}
                    occurrences={row.occurrences}
                  />
                ) : null}
                <Button
                  type="button"
                  className="min-h-[44px] w-full"
                  aria-label={`Adopt ${row.merchant} as bill`}
                  onClick={() => onAdopt(row)}
                >
                  Adopt
                </Button>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
