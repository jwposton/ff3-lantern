import { ChevronDown, ChevronRight } from "lucide-react"
import { Fragment } from "react"

import { BillSuggestionIgnoreMenu } from "@/components/payment-run/BillSuggestionIgnoreMenu"
import { BillSuggestionTransactionsPanel } from "@/components/payment-run/BillSuggestionTransactionsPanel"
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
import { formatDisplayDate } from "@/lib/formatDisplay"
import type { BillSuggestion } from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

const DESKTOP_COLUMN_COUNT = 10

const AMOUNT_CELL_CLASS = "text-center align-middle tabular-nums text-xs"

function parseSuggestionAmount(value: string): number | null {
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

/** True when min and max are within one cent (fixed subscription-style amounts). */
export function isFixedSuggestionAmount(min: string, max: string): boolean {
  const minVal = parseSuggestionAmount(min)
  const maxVal = parseSuggestionAmount(max)
  if (minVal === null || maxVal === null) return true
  return Math.abs(minVal - maxVal) < 0.01
}

function formatCompactAmount(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—"
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value).replace(/,/g, ""))
  if (!Number.isFinite(parsed)) return String(value)
  const cents = Math.abs(Math.round(parsed * 100) % 100)
  if (cents === 0) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(parsed)
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed)
}

/** @internal exported for tests */
export function formatSuggestionAmountRange(min: string, max: string): string {
  return `${formatCompactAmount(min)} - ${formatCompactAmount(max)}`
}

export function BillSuggestionAmountDisplay({
  row,
  className,
}: {
  row: Pick<BillSuggestion, "amount_min" | "amount_avg" | "amount_max">
  className?: string
}) {
  const fixed = isFixedSuggestionAmount(row.amount_min, row.amount_max)

  if (fixed) {
    const primary =
      row.amount_avg?.trim() ||
      row.amount_min?.trim() ||
      row.amount_max?.trim() ||
      ""
    return (
      <span className={className}>{formatCompactAmount(primary || null)}</span>
    )
  }

  return (
    <div className={cn("leading-snug", className)}>
      <div>{formatCompactAmount(row.amount_avg)}</div>
      <div className="text-muted-foreground text-[0.65rem] leading-tight">
        {formatSuggestionAmountRange(row.amount_min, row.amount_max)}
      </div>
    </div>
  )
}

const WRAP_CELL_CLASS =
  "max-w-[5.5rem] min-w-[3.5rem] text-center text-xs leading-snug break-words whitespace-normal align-middle"

const DATA_CELL_CLASS = "text-center align-middle"

function formatCategoryLabel(category: string | undefined | null): string {
  const text = (category ?? "").trim()
  return text || "—"
}

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
  if (!payee) return null
  return `Payee: ${payee}`
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
}: {
  row: BillSuggestion
  isExpanded: boolean
  onToggleExpanded: (id: string) => void
}) {
  const panelId = `discover-txn-panel-${row.id}`

  if (row.occurrences === 0) {
    return null
  }

  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground rounded p-0.5"
      aria-expanded={isExpanded}
      aria-controls={panelId}
      aria-label={
        isExpanded
          ? `Hide withdrawals for ${row.merchant}`
          : `Show withdrawals for ${row.merchant}`
      }
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
}: {
  row: BillSuggestion
  isExpanded: boolean
  onToggleExpanded: (id: string) => void
}) {
  const panelId = `discover-txn-panel-${row.id}`

  if (row.occurrences === 0) {
    return <span className="min-h-[44px] min-w-[44px] shrink-0" aria-hidden />
  }

  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded"
      aria-expanded={isExpanded}
      aria-controls={panelId}
      aria-label={
        isExpanded
          ? `Hide withdrawals for ${row.merchant}`
          : `Show withdrawals for ${row.merchant}`
      }
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
                <TableHead className="min-w-[8rem] text-center">Bill</TableHead>
                <TableHead className="min-w-[3.5rem] text-center">Paid via</TableHead>
                <TableHead className="w-[4rem] text-center">Freq</TableHead>
                <TableHead className="w-[3rem] text-center">Hits</TableHead>
                <TableHead className="min-w-[4.5rem] text-center">Amount</TableHead>
                <TableHead className="w-[5.5rem] text-center">Last</TableHead>
                <TableHead className="min-w-[3.5rem] text-center">Cat.</TableHead>
                <TableHead className="w-[5rem] text-center">Confidence</TableHead>
                <TableHead className="min-w-[7rem] text-center">Action</TableHead>
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
                        />
                      </TableCell>
                      <TableCell className={DATA_CELL_CLASS}>
                        <div className="font-medium">{row.merchant}</div>
                        {detail ? (
                          <p className="text-xs text-muted-foreground">
                            {detail}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className={cn(WRAP_CELL_CLASS, "text-muted-foreground")}>
                        {row.payment_source}
                      </TableCell>
                      <TableCell className={DATA_CELL_CLASS}>
                        {capitalizeLabel(row.freq)}
                      </TableCell>
                      <TableCell className={cn(DATA_CELL_CLASS, "tabular-nums")}>
                        {row.occurrences}
                      </TableCell>
                      <TableCell className={AMOUNT_CELL_CLASS}>
                        <BillSuggestionAmountDisplay row={row} />
                      </TableCell>
                      <TableCell className={cn(DATA_CELL_CLASS, "tabular-nums")}>
                        {formatDisplayDate(row.last_date)}
                      </TableCell>
                      <TableCell
                        className={cn(WRAP_CELL_CLASS, "text-muted-foreground")}
                      >
                        {formatCategoryLabel(row.category)}
                      </TableCell>
                      <TableCell className={DATA_CELL_CLASS}>
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-transparent font-normal text-xs",
                            confidenceBadgeClass(row.confidence),
                          )}
                        >
                          {capitalizeLabel(row.confidence)}
                        </Badge>
                      </TableCell>
                      <TableCell className={DATA_CELL_CLASS}>
                        <div className="flex flex-nowrap items-center justify-center gap-0.5">
                          <Button
                            type="button"
                            size="xs"
                            aria-label={`Adopt ${row.merchant} as bill`}
                            onClick={() => onAdopt(row)}
                          >
                            Adopt
                          </Button>
                          <BillSuggestionIgnoreMenu
                            row={row}
                            payeeSectionRowCount={rows.length}
                            lookbackMonths={lookbackMonths}
                            size="xs"
                          />
                        </div>
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
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{row.merchant}</p>
                    {detail ? (
                      <p className="text-xs text-muted-foreground">{detail}</p>
                    ) : null}
                  </div>
                </div>
                <p className="text-xs tabular-nums">
                  <BillSuggestionAmountDisplay row={row} />
                </p>
                <p className="text-xs text-muted-foreground">
                  {capitalizeLabel(row.freq)} · {row.occurrences} hits ·{" "}
                  <span title={row.payment_source}>{row.payment_source}</span>
                  {" · Cat. "}
                  {formatCategoryLabel(row.category)}
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
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="min-h-[44px] flex-1"
                    aria-label={`Adopt ${row.merchant} as bill`}
                    onClick={() => onAdopt(row)}
                  >
                    Adopt
                  </Button>
                  <BillSuggestionIgnoreMenu
                    row={row}
                    payeeSectionRowCount={rows.length}
                    lookbackMonths={lookbackMonths}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
