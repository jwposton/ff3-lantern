import { ChevronDown, ChevronRight, Pencil } from "lucide-react"
import { Fragment, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { PlannedAmountInput } from "@/components/payment-run/PlannedAmountInput"
import {
  ACTIONS_CELL_CLASS,
  ACTIONS_HEAD_CLASS,
  COMPACT_TABLE,
  WorksheetNameLink,
  bucketLabel,
  nextSortDirection,
  sortDirectionIndicator,
  type SortDirection,
} from "@/components/payment-run/worksheetTableUtils"
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

const COLUMN_COUNT = 14

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
  onEditDetails?: (row: CreditCardRow) => void
}

type CcSortKey =
  | "name"
  | "bucket"
  | "limit"
  | "due"
  | "apr"
  | "util"
  | "owed"
  | "lastPmt"
  | "new"
  | "interest"
  | "fees"
  | "planned"
  | "paid"

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function defaultSortCompare(a: CreditCardRow, b: CreditCardRow): number {
  const ao = a.sort_order ?? 999_999
  const bo = b.sort_order ?? 999_999
  if (ao !== bo) return ao - bo
  const nameCmp = (a.name ?? "").localeCompare(b.name ?? "")
  if (nameCmp !== 0) return nameCmp
  return a.account_id.localeCompare(b.account_id)
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

function utilSortValue(owed: string, creditLimit: string | null | undefined): number {
  if (!creditLimit) return -1
  const limit = Number.parseFloat(creditLimit)
  if (!Number.isFinite(limit) || limit <= 0) return -1
  const owedAmount = Math.abs(Number.parseFloat(owed))
  if (!Number.isFinite(owedAmount)) return -1
  return (owedAmount / limit) * 100
}

function SortableHead({
  label,
  columnKey,
  activeKey,
  direction,
  onSort,
  className,
}: {
  label: string
  columnKey: CcSortKey
  activeKey: CcSortKey | null
  direction: SortDirection
  onSort: (key: CcSortKey) => void
  className?: string
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        className="inline-flex w-full items-center gap-0.5 hover:text-foreground"
        onClick={() => onSort(columnKey)}
      >
        <span>{label}</span>
        <span
          className="text-muted-foreground text-[10px]"
          aria-hidden
        >
          {sortDirectionIndicator(activeKey, columnKey, direction)}
        </span>
      </button>
    </TableHead>
  )
}

type ActivitySortKey =
  | "date"
  | "description"
  | "payee"
  | "category"
  | "budget"
  | "amount"

function defaultActivityCompare(
  a: CreditCardActivityTransaction,
  b: CreditCardActivityTransaction,
): number {
  const budgetCmp = (a.budget ?? "").localeCompare(b.budget ?? "")
  if (budgetCmp !== 0) return budgetCmp
  return (a.category ?? "").localeCompare(b.category ?? "")
}

function activitySortIndicator(
  sortKey: ActivitySortKey | null,
  columnKey: ActivitySortKey,
  direction: SortDirection,
): string {
  if (sortKey === null) {
    if (columnKey === "budget" || columnKey === "category") return "↑"
    return "↕"
  }
  return sortDirectionIndicator(sortKey, columnKey, direction)
}

function ActivitySortableHead({
  label,
  columnKey,
  sortKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string
  columnKey: ActivitySortKey
  sortKey: ActivitySortKey | null
  direction: SortDirection
  onSort: (key: ActivitySortKey) => void
  align?: "left" | "right"
}) {
  return (
    <th
      className={cn(
        "pr-3 font-medium text-muted-foreground",
        align === "right" ? "text-right" : "text-left",
        columnKey === "date" && "whitespace-nowrap",
      )}
    >
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-0.5 hover:text-foreground",
          align === "right" && "w-full justify-end",
        )}
        onClick={() => onSort(columnKey)}
      >
        <span>{label}</span>
        <span className="text-muted-foreground text-[10px]" aria-hidden>
          {activitySortIndicator(sortKey, columnKey, direction)}
        </span>
      </button>
    </th>
  )
}

function NewActivitySubTable({
  transactions,
  fireflyBaseUrl,
}: {
  transactions: CreditCardActivityTransaction[]
  fireflyBaseUrl?: string
}) {
  const [sortKey, setSortKey] = useState<ActivitySortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDirection>("asc")

  const comparators = useMemo(
    (): Record<
      ActivitySortKey,
      (a: CreditCardActivityTransaction, b: CreditCardActivityTransaction) => number
    > => ({
      date: (a, b) => a.date.localeCompare(b.date),
      description: (a, b) => a.description.localeCompare(b.description),
      payee: (a, b) => (a.payee ?? "").localeCompare(b.payee ?? ""),
      category: (a, b) => (a.category ?? "").localeCompare(b.category ?? ""),
      budget: (a, b) => (a.budget ?? "").localeCompare(b.budget ?? ""),
      amount: (a, b) => parseAmount(a.amount) - parseAmount(b.amount),
    }),
    [],
  )

  const sortedTransactions = useMemo(() => {
    const copy = [...transactions]
    if (sortKey === null) {
      copy.sort(defaultActivityCompare)
      return copy
    }
    const compare = comparators[sortKey]
    copy.sort((a, b) => {
      const result = compare(a, b)
      return sortDir === "asc" ? result : -result
    })
    return copy
  }, [transactions, sortKey, sortDir, comparators])

  function toggleActivitySort(key: ActivitySortKey) {
    setSortDir((currentDir) => nextSortDirection(sortKey, key, currentDir))
    setSortKey(key)
  }

  return (
    <div className="bg-muted/30 border-t px-4 py-2.5">
      <div className="ml-auto w-fit max-w-full overflow-x-auto">
        <table className="w-max max-w-full table-fixed text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:py-1 [&_th]:py-1">
          <colgroup>
            <col style={{ width: "5.5rem" }} />
            <col style={{ width: "6.5rem" }} />
            <col style={{ width: "8rem" }} />
            <col style={{ width: "8rem" }} />
            <col style={{ width: "7rem" }} />
            <col style={{ width: "5.5rem" }} />
          </colgroup>
          <thead>
            <tr>
              <ActivitySortableHead
                label="Date"
                columnKey="date"
                sortKey={sortKey}
                direction={sortDir}
                onSort={toggleActivitySort}
              />
              <ActivitySortableHead
                label="Description"
                columnKey="description"
                sortKey={sortKey}
                direction={sortDir}
                onSort={toggleActivitySort}
              />
              <ActivitySortableHead
                label="Payee"
                columnKey="payee"
                sortKey={sortKey}
                direction={sortDir}
                onSort={toggleActivitySort}
              />
              <ActivitySortableHead
                label="Category"
                columnKey="category"
                sortKey={sortKey}
                direction={sortDir}
                onSort={toggleActivitySort}
              />
              <ActivitySortableHead
                label="Budget"
                columnKey="budget"
                sortKey={sortKey}
                direction={sortDir}
                onSort={toggleActivitySort}
              />
              <ActivitySortableHead
                label="Amount"
                columnKey="amount"
                sortKey={sortKey}
                direction={sortDir}
                onSort={toggleActivitySort}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {sortedTransactions.map((txn, index) => {
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
                        title={txn.description}
                      >
                        {txn.description}
                      </a>
                    ) : (
                      <span className="block truncate" title={txn.description}>
                        {txn.description}
                      </span>
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
  const [sortKey, setSortKey] = useState<CcSortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDirection>("asc")

  const comparators = useMemo(
    (): Record<CcSortKey, (a: CreditCardRow, b: CreditCardRow) => number> => ({
      name: (a, b) => (a.name ?? "").localeCompare(b.name ?? ""),
      bucket: (a, b) =>
        bucketLabel(buckets, a.funding_bucket_key).localeCompare(
          bucketLabel(buckets, b.funding_bucket_key),
        ),
      limit: (a, b) => parseAmount(a.credit_limit) - parseAmount(b.credit_limit),
      due: (a, b) =>
        parseAmount(a.payment_due_day) - parseAmount(b.payment_due_day),
      apr: (a, b) => parseAmount(a.apr_percent) - parseAmount(b.apr_percent),
      util: (a, b) =>
        utilSortValue(a.owed, a.credit_limit) -
        utilSortValue(b.owed, b.credit_limit),
      owed: (a, b) => parseAmount(a.owed) - parseAmount(b.owed),
      lastPmt: (a, b) =>
        parseAmount(a.last_payment_amount) - parseAmount(b.last_payment_amount),
      new: (a, b) => parseAmount(a.new_total) - parseAmount(b.new_total),
      interest: (a, b) =>
        parseAmount(a.interest_accrued) - parseAmount(b.interest_accrued),
      fees: (a, b) => parseAmount(a.fees) - parseAmount(b.fees),
      planned: (a, b) =>
        parseAmount(a.planned_amount) - parseAmount(b.planned_amount),
      paid: (a, b) => Number(Boolean(a.paid_at)) - Number(Boolean(b.paid_at)),
    }),
    [buckets],
  )

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    if (sortKey === null) {
      copy.sort(defaultSortCompare)
      return copy
    }
    const compare = comparators[sortKey]
    copy.sort((a, b) => {
      const result = compare(a, b)
      return sortDir === "asc" ? result : -result
    })
    return copy
  }, [rows, sortKey, sortDir, comparators])

  function toggleSort(key: CcSortKey) {
    setSortDir((currentDir) => nextSortDirection(sortKey, key, currentDir))
    setSortKey(key)
  }

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
              <SortableHead
                label="Card"
                columnKey="name"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className="max-w-[7rem]"
              />
              <SortableHead
                label="Account"
                columnKey="bucket"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className={XL_COL}
              />
              <SortableHead
                label="Limit"
                columnKey="limit"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className={cn("text-right", XL_COL)}
              />
              <SortableHead
                label="Due"
                columnKey="due"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className={cn("text-right", XL_COL)}
              />
              <SortableHead
                label="APR"
                columnKey="apr"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className={cn("text-right", XL_COL)}
              />
              <SortableHead
                label="Util"
                columnKey="util"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className={cn("text-right", XL_COL)}
              />
              <SortableHead
                label="Owed"
                columnKey="owed"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className="text-right"
              />
              <SortableHead
                label="Last pmt"
                columnKey="lastPmt"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className="text-right"
              />
              <SortableHead
                label="New"
                columnKey="new"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className="text-right"
              />
              <SortableHead
                label="Int."
                columnKey="interest"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className="text-right"
              />
              <SortableHead
                label="Fees"
                columnKey="fees"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className="text-right"
              />
              <SortableHead
                label="Planned"
                columnKey="planned"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className="text-right"
              />
              <SortableHead
                label="Paid"
                columnKey="paid"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                className="w-[4.5rem] text-center"
              />
              <TableHead className={ACTIONS_HEAD_CLASS}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => {
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
                        <WorksheetNameLink
                          href={fireflyAccountUrl}
                          className="min-w-0"
                          title={`${cardName} — open in Firefly`}
                        >
                          {cardName}
                        </WorksheetNameLink>
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
                    <TableCell className={ACTIONS_CELL_CLASS}>
                      {onEditDetails ? (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground rounded p-0.5"
                          aria-label={`Edit ${cardName} worksheet details`}
                          onClick={() => onEditDetails(row)}
                        >
                          <Pencil className="size-3" aria-hidden />
                        </button>
                      ) : (
                        <Link
                          to={`/manage/payment-run/cards/${encodeURIComponent(row.account_id)}`}
                          className="text-muted-foreground hover:text-foreground inline-flex rounded p-0.5"
                          aria-label={`Manage ${cardName}`}
                        >
                          <Pencil className="size-3" aria-hidden />
                        </Link>
                      )}
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
                <TableCell className="max-w-[7rem]">Subtotal</TableCell>
                <TableCell className={XL_COL} />
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
                <TableCell className={ACTIONS_CELL_CLASS}>—</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
