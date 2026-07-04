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

export function billColumnSubtitle(row: BillSuggestion): string | null {
  if (row.cluster) {
    const raw = row.register_prefill.destination_account?.trim()
    return raw ? `via ${raw}` : null
  }
  return row.notes?.trim() || null
}

function reviewHighlightClass(row: BillSuggestion): string {
  if (row.status === "review" || (row.notes && !row.cluster)) {
    return "border-l-4 border-l-amber-500/70 bg-amber-50/40 dark:bg-amber-950/20"
  }
  return ""
}

type BillSuggestionBucketSectionProps = {
  bucketName: string
  rows: BillSuggestion[]
  onAdopt: (row: BillSuggestion) => void
}

export function BillSuggestionBucketSection({
  bucketName,
  rows,
  onAdopt,
}: BillSuggestionBucketSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h2 className="text-xl font-semibold">
          {bucketName} ({rows.length})
        </h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="hidden overflow-x-auto rounded-md border sm:block">
          <Table className={COMPACT_TABLE}>
            <TableHeader>
              <TableRow>
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
                const subtitle = billColumnSubtitle(row)
                return (
                <TableRow
                  key={row.id}
                  className={cn(reviewHighlightClass(row))}
                >
                  <TableCell>
                    <div className="font-medium">{row.merchant}</div>
                    {subtitle ? (
                      <p className="text-xs text-muted-foreground">{subtitle}</p>
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
                )
              })}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3 sm:hidden">
          {rows.map((row) => {
            const subtitle = billColumnSubtitle(row)
            return (
            <div
              key={row.id}
              className={cn(
                "space-y-2 rounded-md border p-3",
                reviewHighlightClass(row),
              )}
            >
              <div>
                <p className="font-medium">{row.merchant}</p>
                {subtitle ? (
                  <p className="text-xs text-muted-foreground">{subtitle}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
                <span>
                  Min {formatDisplayAmount(row.amount_min)}
                </span>
                <span>
                  Avg {formatDisplayAmount(row.amount_avg)}
                </span>
                <span>
                  Max {formatDisplayAmount(row.amount_max)}
                </span>
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
