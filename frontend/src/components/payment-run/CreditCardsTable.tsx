import { ChevronDown, ChevronRight, Pencil } from "lucide-react"
import { Fragment, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { PlannedAmountInput } from "@/components/payment-run/PlannedAmountInput"
import { WorksheetPortalLinkAnchor } from "@/components/payment-run/WorksheetPortalLinkAnchor"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
  align = "left",
}: {
  label: string
  columnKey: CcSortKey
  activeKey: CcSortKey | null
  direction: SortDirection
  onSort: (key: CcSortKey) => void
  className?: string
  align?: "left" | "right" | "center"
}) {
  return (
    <TableHead
      className={cn(
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      <button
        type="button"
        className={cn(
          "inline-flex w-full items-center gap-0.5 hover:text-foreground",
          align === "right" && "justify-end",
          align === "center" && "justify-center",
        )}
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

const UNASSIGNED_GROUP_LABEL = "Unassigned"

function activityGroupLabel(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : UNASSIGNED_GROUP_LABEL
}

function sumActivityAmounts(
  transactions: CreditCardActivityTransaction[],
): number {
  return transactions.reduce((sum, txn) => sum + parseAmount(txn.amount), 0)
}

type ActivityCategoryGroup = {
  key: string
  label: string
  transactions: CreditCardActivityTransaction[]
  total: number
}

type ActivityBudgetGroup = {
  key: string
  label: string
  categories: ActivityCategoryGroup[]
  total: number
}

/** Group New activity as Budget → Category → transactions (sorted by label). */
export function groupActivityByBudgetThenCategory(
  transactions: CreditCardActivityTransaction[],
): ActivityBudgetGroup[] {
  const budgetMap = new Map<string, Map<string, CreditCardActivityTransaction[]>>()

  for (const txn of transactions) {
    const budgetKey = activityGroupLabel(txn.budget)
    const categoryKey = activityGroupLabel(txn.category)
    let categories = budgetMap.get(budgetKey)
    if (!categories) {
      categories = new Map()
      budgetMap.set(budgetKey, categories)
    }
    const existing = categories.get(categoryKey)
    if (existing) {
      existing.push(txn)
    } else {
      categories.set(categoryKey, [txn])
    }
  }

  const budgets: ActivityBudgetGroup[] = [...budgetMap.entries()].map(
    ([budgetLabel, categoryMap]) => {
      const categories: ActivityCategoryGroup[] = [...categoryMap.entries()]
        .map(([categoryLabel, txns]) => {
          const sortedTxns = [...txns].sort((a, b) => a.date.localeCompare(b.date))
          return {
            key: categoryLabel,
            label: categoryLabel,
            transactions: sortedTxns,
            total: sumActivityAmounts(sortedTxns),
          }
        })
        .sort((a, b) => a.label.localeCompare(b.label))

      return {
        key: budgetLabel,
        label: budgetLabel,
        categories,
        total: categories.reduce((sum, cat) => sum + cat.total, 0),
      }
    },
  )

  budgets.sort((a, b) => a.label.localeCompare(b.label))
  return budgets
}

type LeafTxnSortKey = "date" | "description" | "payee" | "amount"

function ActivityLeafSortableHead({
  label,
  columnKey,
  sortKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string
  columnKey: LeafTxnSortKey
  sortKey: LeafTxnSortKey
  direction: SortDirection
  onSort: (key: LeafTxnSortKey) => void
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
          {sortDirectionIndicator(sortKey, columnKey, direction)}
        </span>
      </button>
    </th>
  )
}

function ActivityGroupToggle({
  label,
  amount,
  expanded,
  onToggle,
  depth,
  level,
}: {
  label: string
  amount: number
  expanded: boolean
  onToggle: () => void
  depth: 0 | 1
  level: "budget" | "category"
}) {
  return (
    <button
      type="button"
      className={cn(
        "hover:bg-muted/50 flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs",
        depth === 0 ? "font-medium" : "text-muted-foreground pl-4",
      )}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${level} ${label}`}
      onClick={onToggle}
    >
      {expanded ? (
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate" aria-hidden>
        {label}
      </span>
      <span className="tabular-nums whitespace-nowrap" aria-hidden>
        {formatDisplayAmount(amount)}
      </span>
    </button>
  )
}

function CategoryTransactionTable({
  transactions,
  fireflyBaseUrl,
}: {
  transactions: CreditCardActivityTransaction[]
  fireflyBaseUrl?: string
}) {
  const [sortKey, setSortKey] = useState<LeafTxnSortKey>("date")
  const [sortDir, setSortDir] = useState<SortDirection>("asc")

  const sortedTransactions = useMemo(() => {
    const copy = [...transactions]
    const compare = (
      a: CreditCardActivityTransaction,
      b: CreditCardActivityTransaction,
    ): number => {
      switch (sortKey) {
        case "description":
          return a.description.localeCompare(b.description)
        case "payee":
          return (a.payee ?? "").localeCompare(b.payee ?? "")
        case "amount":
          return parseAmount(a.amount) - parseAmount(b.amount)
        case "date":
        default:
          return a.date.localeCompare(b.date)
      }
    }
    copy.sort((a, b) => {
      const result = compare(a, b)
      return sortDir === "asc" ? result : -result
    })
    return copy
  }, [transactions, sortKey, sortDir])

  function toggleSort(key: LeafTxnSortKey) {
    setSortDir((currentDir) => nextSortDirection(sortKey, key, currentDir))
    setSortKey(key)
  }

  return (
    <div className="ml-auto w-fit max-w-full overflow-x-auto pl-8">
      <table className="w-max max-w-full table-fixed text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:py-1 [&_th]:py-1">
        <colgroup>
          <col style={{ width: "5.5rem" }} />
          <col style={{ width: "8rem" }} />
          <col style={{ width: "8rem" }} />
          <col style={{ width: "5.5rem" }} />
        </colgroup>
        <thead>
          <tr>
            <ActivityLeafSortableHead
              label="Date"
              columnKey="date"
              sortKey={sortKey}
              direction={sortDir}
              onSort={toggleSort}
            />
            <ActivityLeafSortableHead
              label="Description"
              columnKey="description"
              sortKey={sortKey}
              direction={sortDir}
              onSort={toggleSort}
            />
            <ActivityLeafSortableHead
              label="Payee"
              columnKey="payee"
              sortKey={sortKey}
              direction={sortDir}
              onSort={toggleSort}
            />
            <ActivityLeafSortableHead
              label="Amount"
              columnKey="amount"
              sortKey={sortKey}
              direction={sortDir}
              onSort={toggleSort}
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

function NewActivitySubTable({
  transactions,
  fireflyBaseUrl,
}: {
  transactions: CreditCardActivityTransaction[]
  fireflyBaseUrl?: string
}) {
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(
    () => new Set(),
  )
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(),
  )

  const budgetGroups = useMemo(
    () => groupActivityByBudgetThenCategory(transactions),
    [transactions],
  )

  function toggleBudget(key: string) {
    setExpandedBudgets((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleCategory(budgetKey: string, categoryKey: string) {
    const compound = `${budgetKey}::${categoryKey}`
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(compound)) next.delete(compound)
      else next.add(compound)
      return next
    })
  }

  return (
    <div className="bg-muted/30 border-t px-4 py-2.5">
      <div className="ml-auto w-full max-w-xl space-y-0.5">
        {budgetGroups.map((budget) => {
          const budgetExpanded = expandedBudgets.has(budget.key)
          return (
            <div key={budget.key}>
              <ActivityGroupToggle
                label={budget.label}
                amount={budget.total}
                expanded={budgetExpanded}
                onToggle={() => toggleBudget(budget.key)}
                depth={0}
                level="budget"
              />
              {budgetExpanded
                ? budget.categories.map((category) => {
                    const compound = `${budget.key}::${category.key}`
                    const categoryExpanded = expandedCategories.has(compound)
                    return (
                      <div key={compound}>
                        <ActivityGroupToggle
                          label={category.label}
                          amount={category.total}
                          expanded={categoryExpanded}
                          onToggle={() =>
                            toggleCategory(budget.key, category.key)
                          }
                          depth={1}
                          level="category"
                        />
                        {categoryExpanded ? (
                          <CategoryTransactionTable
                            transactions={category.transactions}
                            fireflyBaseUrl={fireflyBaseUrl}
                          />
                        ) : null}
                      </div>
                    )
                  })
                : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatPromoTooltipCopy(
  specialAprPercent: string | null | undefined,
  specialAprEnd: string | null | undefined,
): string | null {
  if (!specialAprPercent || !specialAprEnd) return null
  return `${formatInterestPercent(specialAprPercent)} until ${specialAprEnd}`
}

function AprCell({ row }: { row: CreditCardRow }) {
  const displayApr = formatInterestPercent(row.apr_percent)

  if (!row.promo_active) {
    return <>{displayApr}</>
  }

  const tooltipCopy = formatPromoTooltipCopy(
    row.special_apr_percent,
    row.special_apr_end,
  )

  const emphasizedApr = (
    <span
      className="inline-block rounded-sm px-1 ring-1 ring-amber-500/30"
      data-testid="apr-promo-emphasis"
    >
      {displayApr}
    </span>
  )

  if (!tooltipCopy) {
    return emphasizedApr
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={tooltipCopy}
          data-testid="apr-promo-tooltip-trigger"
        >
          {emphasizedApr}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipCopy}</TooltipContent>
    </Tooltip>
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
                align="right"
                className={XL_COL}
              />
              <SortableHead
                label="Due"
                columnKey="due"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                align="right"
                className={XL_COL}
              />
              <SortableHead
                label="APR"
                columnKey="apr"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                align="right"
                className={XL_COL}
              />
              <SortableHead
                label="Util"
                columnKey="util"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                align="right"
                className={XL_COL}
              />
              <SortableHead
                label="Owed"
                columnKey="owed"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHead
                label="Last pmt"
                columnKey="lastPmt"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHead
                label="New"
                columnKey="new"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHead
                label="Int."
                columnKey="interest"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHead
                label="Fees"
                columnKey="fees"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHead
                label="Planned"
                columnKey="planned"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHead
                label="Paid"
                columnKey="paid"
                activeKey={sortKey}
                direction={sortDir}
                onSort={toggleSort}
                align="center"
                className="w-[4.5rem]"
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
                      <AprCell row={row} />
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
                      <div className="inline-flex items-center justify-center gap-0.5">
                        {row.external_link ? (
                          <WorksheetPortalLinkAnchor
                            link={row.external_link}
                            rowName={cardName}
                          />
                        ) : null}
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
                      </div>
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
