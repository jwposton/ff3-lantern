import { ChevronDown, ChevronRight, Pencil } from "lucide-react"
import { Fragment, useMemo, useState } from "react"

import { PlannedAmountInput } from "@/components/payment-run/PlannedAmountInput"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDisplayAmount, formatDisplayDate } from "@/lib/formatDisplay"
import { buildFireflyAccountUrl, buildFireflyTransactionUrl } from "@/lib/fireflyLinks"
import {
  computeCreditCardSubtotals,
  formatInterestPercent,
  formatPaymentDueDay,
  shouldHighlightCreditCardDue,
} from "@/lib/paymentRunFormat"
import type {
  CreditCardActivityTransaction,
  CreditCardRow,
  FundingBucketRollup,
} from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

const COMPACT_TABLE =
  "text-xs [&_th]:h-8 [&_th]:px-2 [&_th]:py-1 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-xs [&_td]:min-h-0"

const COLUMN_COUNT = 13

/** Bucket, limit, due, APR, util — detail columns shown from xl up to avoid horizontal scroll. */
const XL_COL = "hidden xl:table-cell"

type CreditCardsTableProps = {
  rows: CreditCardRow[]
  buckets: FundingBucketRollup[]
  month: string
  fireflyBaseUrl?: string
  onPlannedBlur: (
    rowKey: string,
    body: { planned_amount: string; clear_planned_override?: boolean },
  ) => Promise<void>
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

function NewActivitySubTable({
  transactions,
  fireflyBaseUrl,
}: {
  transactions: CreditCardActivityTransaction[]
  fireflyBaseUrl?: string
}) {
  return (
    <div className="bg-muted/30 border-t px-4 py-2.5 sm:pl-28">
      <table className="w-full text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:py-1 [&_th]:py-1">
        <thead>
          <tr>
            <th className="w-[5.5rem] pr-3 text-left whitespace-nowrap">Date</th>
            <th className="pr-3 text-left">Description</th>
            <th className="w-[8rem] pr-3 text-left">Payee</th>
            <th className="w-[8rem] pr-3 text-left">Category</th>
            <th className="w-[7rem] pr-3 text-left">Budget</th>
            <th className="w-[5.5rem] text-right whitespace-nowrap">Amount</th>
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
                <td className="pr-3">
                  {fireflyUrl ? (
                    <a
                      href={fireflyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      title={txn.description}
                    >
                      {txn.description}
                    </a>
                  ) : (
                    <span title={txn.description}>{txn.description}</span>
                  )}
                </td>
                <td
                  className="text-muted-foreground pr-3 truncate"
                  title={txn.payee ?? undefined}
                >
                  {txn.payee ?? "—"}
                </td>
                <td
                  className="text-muted-foreground pr-3 truncate"
                  title={txn.category ?? undefined}
                >
                  {txn.category ?? "—"}
                </td>
                <td
                  className="text-muted-foreground pr-3 truncate"
                  title={txn.budget ?? undefined}
                >
                  {txn.budget ?? "—"}
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
  )
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
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set())

  function toggleExpanded(rowKey: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowKey)) {
        next.delete(rowKey)
      } else {
        next.add(rowKey)
      }
      return next
    })
  }

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
              const activity = row.new_transactions ?? []
              const canExpand = activity.length > 0
              const isExpanded = expandedRows.has(row.row_key)
              return (
                <Fragment key={row.row_key}>
                  <TableRow
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
                      <div className="flex items-center justify-end gap-0.5">
                        {canExpand ? (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Hide" : "Show"} new transactions for ${cardName}`}
                            onClick={() => toggleExpanded(row.row_key)}
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-3.5" aria-hidden />
                            ) : (
                              <ChevronRight className="size-3.5" aria-hidden />
                            )}
                          </button>
                        ) : null}
                        <span>{formatDisplayAmount(row.new_total)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDisplayAmount(row.interest_accrued)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDisplayAmount(row.fees)}
                    </TableCell>
                    <TableCell className="text-right">
                      <PlannedAmountInput
                        row={row}
                        isPaid={isPaid}
                        onCommit={onPlannedBlur}
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
                  {isExpanded && canExpand ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={COLUMN_COUNT} className="p-0">
                        <NewActivitySubTable
                          transactions={activity}
                          fireflyBaseUrl={fireflyBaseUrl}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
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
