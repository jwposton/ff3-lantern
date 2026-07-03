import { Pencil } from "lucide-react"
import { useMemo } from "react"

import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import { buildFireflyAccountUrl } from "@/lib/fireflyLinks"
import {
  computeCreditCardSubtotals,
  formatInterestPercent,
  formatPaymentDueDay,
  shouldHighlightCreditCardDue,
} from "@/lib/paymentRunFormat"
import type { CreditCardRow, FundingBucketRollup } from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

const COMPACT_TABLE =
  "text-xs [&_th]:h-8 [&_th]:px-2 [&_th]:py-1 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-xs [&_td]:min-h-0"

/** Bucket, limit, due, APR, util — detail columns shown from xl up to avoid horizontal scroll. */
const XL_COL = "hidden xl:table-cell"

type CreditCardsTableProps = {
  rows: CreditCardRow[]
  buckets: FundingBucketRollup[]
  month: string
  fireflyBaseUrl?: string
  onPlannedBlur: (rowKey: string, value: string) => Promise<void>
  onPaidChange: (row: CreditCardRow, paid: boolean) => Promise<void>
  onEditDetails: (row: CreditCardRow) => void
}

function formatUtilPercent(
  owed: string,
  creditLimit: string | null | undefined,
): string {
  if (!creditLimit) return "—"
  const limit = Number.parseFloat(creditLimit)
  if (!Number.isFinite(limit) || limit <= 0) return "—"
  const owedAmount = Math.abs(Number.parseFloat(owed))
  if (!Number.isFinite(owedAmount)) return "—"
  return `${((owedAmount / limit) * 100).toFixed(1)}%`
}

function bucketLabel(
  buckets: FundingBucketRollup[],
  bucketKey: string | null | undefined,
): string {
  if (!bucketKey) return "—"
  return buckets.find((bucket) => bucket.id === bucketKey)?.label ?? "—"
}

export function CreditCardsTable({
  rows,
  buckets,
  month,
  fireflyBaseUrl,
  onPlannedBlur,
  onPaidChange,
  onEditDetails,
}: CreditCardsTableProps) {
  const totals = useMemo(() => computeCreditCardSubtotals(rows), [rows])
  const paidCount = totals.paid_count

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table className={COMPACT_TABLE}>
          <TableHeader>
            <TableRow>
              <TableHead className="max-w-[7rem]">Card</TableHead>
              <TableHead className={XL_COL}>Bucket</TableHead>
              <TableHead className={cn("text-right", XL_COL)}>Limit</TableHead>
              <TableHead className={cn("text-right", XL_COL)}>Due</TableHead>
              <TableHead className={cn("text-right", XL_COL)}>APR</TableHead>
              <TableHead className={cn("text-right", XL_COL)}>Util</TableHead>
              <TableHead className="text-right">Owed</TableHead>
              <TableHead className="text-right">Last pmt</TableHead>
              <TableHead className="text-right">New</TableHead>
              <TableHead className="text-right">Int.</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead className="text-right">Planned</TableHead>
              <TableHead className="w-8 text-center">Paid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isPaid = Boolean(row.paid_at)
              const dueHighlight = shouldHighlightCreditCardDue(row, month)
              const cardName = row.name ?? row.account_id
              const fireflyAccountUrl = buildFireflyAccountUrl(
                fireflyBaseUrl,
                row.account_id,
              )
              return (
                <TableRow
                  key={row.row_key}
                  data-state={isPaid ? "paid" : undefined}
                  className={cn(
                    isPaid &&
                      "!bg-green-50 hover:!bg-green-50/90 dark:!bg-green-950/40",
                  )}
                >
                  <TableCell className="max-w-[7rem]">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex min-w-0 items-center gap-0.5">
                        {fireflyAccountUrl ? (
                          <a
                            href={fireflyAccountUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 truncate font-medium hover:underline"
                            title={`${cardName} — open in Firefly`}
                          >
                            {cardName}
                          </a>
                        ) : (
                          <span className="min-w-0 truncate font-medium">
                            {cardName}
                          </span>
                        )}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
                          aria-label={`Edit ${cardName} worksheet details`}
                          onClick={() => onEditDetails(row)}
                        >
                          <Pencil className="size-3" aria-hidden />
                        </button>
                      </div>
                      {dueHighlight ? (
                        <span
                          className="text-destructive text-[10px] font-semibold tabular-nums xl:hidden"
                          title="Due date passed or today — not paid and no payment this month"
                        >
                          Due {formatPaymentDueDay(row.payment_due_day)}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn("max-w-[6rem] truncate text-muted-foreground", XL_COL)}
                  >
                    {bucketLabel(buckets, row.funding_bucket_key)}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", XL_COL)}>
                    {row.credit_limit
                      ? formatDisplayAmount(row.credit_limit)
                      : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      XL_COL,
                      dueHighlight && "text-destructive font-semibold",
                    )}
                    title={
                      dueHighlight
                        ? "Due date passed or today — not paid and no payment this month"
                        : undefined
                    }
                  >
                    {formatPaymentDueDay(row.payment_due_day)}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", XL_COL)}>
                    {formatInterestPercent(row.apr_percent)}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", XL_COL)}>
                    {formatUtilPercent(row.owed, row.credit_limit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDisplayAmount(row.owed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDisplayAmount(row.last_payment_amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDisplayAmount(row.new_total)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDisplayAmount(row.interest_accrued)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDisplayAmount(row.fees)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      className={cn(
                        "ml-auto h-7 w-[4.5rem] px-1.5 text-right text-xs tabular-nums",
                        isPaid && "font-semibold",
                      )}
                      defaultValue={row.planned_amount}
                      onBlur={(event) =>
                        onPlannedBlur(row.row_key, event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur()
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <input
                      type="checkbox"
                      role="checkbox"
                      className="size-3.5"
                      aria-label={`Mark ${cardName} paid`}
                      checked={isPaid}
                      onChange={(event) =>
                        void onPaidChange(row, event.target.checked)
                      }
                    />
                  </TableCell>
                </TableRow>
              )
            })}
            {rows.length > 0 ? (
              <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                <TableCell className="xl:hidden">Subtotal</TableCell>
                <TableCell colSpan={2} className="hidden xl:table-cell">
                  Subtotal
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", XL_COL)}>
                  {totals.credit_limit > 0
                    ? formatDisplayAmount(totals.credit_limit)
                    : "—"}
                </TableCell>
                <TableCell className={cn("text-right", XL_COL)}>—</TableCell>
                <TableCell
                  className={cn("text-right tabular-nums", XL_COL)}
                  title="Balance-weighted average APR"
                >
                  {totals.weighted_apr != null
                    ? `${totals.weighted_apr.toFixed(2)}%`
                    : "—"}
                </TableCell>
                <TableCell
                  className={cn("text-right tabular-nums", XL_COL)}
                  title="Total owed ÷ total limits"
                >
                  {totals.portfolio_util != null
                    ? `${totals.portfolio_util.toFixed(1)}%`
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDisplayAmount(totals.owed)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDisplayAmount(totals.last_payment_amount)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDisplayAmount(totals.new_total)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDisplayAmount(totals.interest_accrued)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDisplayAmount(totals.fees)}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-testid="cc-planned-subtotal"
                >
                  {formatDisplayAmount(totals.planned_amount)}
                </TableCell>
                <TableCell className="text-center tabular-nums text-muted-foreground font-normal">
                  {paidCount}/{rows.length}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
