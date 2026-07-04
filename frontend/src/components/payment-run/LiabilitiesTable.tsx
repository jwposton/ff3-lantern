import { Pencil } from "lucide-react"
import { Link } from "react-router-dom"

import { AmountDueInput } from "@/components/payment-run/AmountDueInput"
import { COMPACT_TABLE, countPaidRows } from "@/components/payment-run/BillsTable"
import { PlannedAmountInput } from "@/components/payment-run/PlannedAmountInput"
import {
  ACTIONS_CELL_CLASS,
  ACTIONS_HEAD_CLASS,
  WorksheetNameLink,
  formatPmtSrc,
} from "@/components/payment-run/worksheetTableUtils"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import { buildFireflyAccountUrl, buildFireflyBillUrl } from "@/lib/fireflyLinks"
import type {
  CreditCardRow,
  FundingBucketRollup,
  LiabilityRow,
  SectionSubtotals,
} from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

export { countPaidRows }

function displayName(row: LiabilityRow): string {
  return row.name ?? row.row_label ?? (row.account_id ? `Account ${row.account_id}` : `Bill ${row.registry_id}`)
}

function isLiabilityAccount(row: LiabilityRow): boolean {
  return Boolean(row.account_id)
}

function isMutedIntermittent(row: LiabilityRow): boolean {
  if (isLiabilityAccount(row)) return false
  return (
    row.amount_mode === "intermittent" &&
    parseAmount(row.amount_due) === 0 &&
    parseAmount(row.planned_amount) === 0 &&
    !row.planned_amount_override &&
    !row.amount_due_override
  )
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function liabilityFireflyUrl(
  row: LiabilityRow,
  fireflyBaseUrl?: string,
): string | null {
  if (row.account_id) {
    return buildFireflyAccountUrl(fireflyBaseUrl, row.account_id)
  }
  return buildFireflyBillUrl(fireflyBaseUrl, row.firefly_bill_id)
}

type LiabilitiesTableProps = {
  rows: LiabilityRow[]
  buckets: FundingBucketRollup[]
  creditCards: CreditCardRow[]
  subtotals: SectionSubtotals["liabilities"]
  fireflyBaseUrl?: string
  onPlannedBlur: (
    rowKey: string,
    body: { planned_amount: string; clear_planned_override?: boolean },
  ) => Promise<void>
  onAmountDueBlur: (
    rowKey: string,
    body: { amount_due: string; clear_amount_due_override?: boolean },
  ) => Promise<void>
  onPaidChange: (row: LiabilityRow, paid: boolean) => Promise<void>
  onEditRegistration?: (row: LiabilityRow) => void
  onEditAccount?: (row: LiabilityRow) => void
}

export function LiabilitiesTable({
  rows,
  buckets,
  creditCards,
  subtotals,
  fireflyBaseUrl,
  onPlannedBlur,
  onAmountDueBlur,
  onPaidChange,
  onEditRegistration,
  onEditAccount,
}: LiabilitiesTableProps) {
  const paidCount = countPaidRows(rows)

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className={COMPACT_TABLE}>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[8.75rem]">Name</TableHead>
            <TableHead className="w-[6.5rem]">Pmt Src</TableHead>
            <TableHead className="w-[6rem] text-right">Owed</TableHead>
            <TableHead className="w-[5.5rem] text-right">Remaining pmt</TableHead>
            <TableHead className="w-[6rem] text-right">Est. interest</TableHead>
            <TableHead className="w-[6rem] text-right">Amt. Due</TableHead>
            <TableHead className="w-[7rem] text-right">Planned</TableHead>
            <TableHead className="w-[4.5rem] text-center">Paid</TableHead>
            <TableHead className={ACTIONS_HEAD_CLASS}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isPaid = Boolean(row.paid_at)
            const name = displayName(row)
            const muted = isMutedIntermittent(row)
            const isAccount = isLiabilityAccount(row)
            const showAutoDraft =
              isAccount && !row.planned_amount_override && parseAmount(row.planned_amount) > 0
            const showManual = row.planned_amount_override
            const fireflyUrl = liabilityFireflyUrl(row, fireflyBaseUrl)
            return (
              <TableRow
                key={row.row_key}
                data-state={
                  muted ? "muted-intermittent" : isPaid ? "paid" : undefined
                }
                className={cn(
                  muted && "opacity-70",
                  isPaid &&
                    "!bg-emerald-50/80 hover:!bg-emerald-50/70 dark:!bg-emerald-950/25",
                )}
              >
                <TableCell className="min-w-[8.75rem]">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <WorksheetNameLink
                      href={fireflyUrl}
                      muted={muted}
                      paid={isPaid}
                    >
                      {name}
                    </WorksheetNameLink>
                    {showAutoDraft ? (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        Auto-draft
                      </Badge>
                    ) : null}
                    {showManual ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        Manual
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="max-w-[6.5rem] truncate text-muted-foreground">
                  {formatPmtSrc(row, buckets, creditCards)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    muted && "text-muted-foreground",
                  )}
                >
                  {isAccount && row.owed
                    ? formatDisplayAmount(row.owed)
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {isAccount && row.remaining_payments != null
                    ? String(row.remaining_payments)
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {isAccount && row.est_interest
                    ? formatDisplayAmount(row.est_interest)
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <AmountDueInput
                    row={row}
                    isPaid={isPaid}
                    onCommit={onAmountDueBlur}
                  />
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
                    aria-label={`Mark ${name} paid`}
                    checked={isPaid}
                    onChange={(event) =>
                      void onPaidChange(row, event.target.checked)
                    }
                  />
                </TableCell>
                <TableCell className={ACTIONS_CELL_CLASS}>
                  {isAccount && onEditAccount ? (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground rounded p-0.5"
                      aria-label={`Edit ${name}`}
                      onClick={() => onEditAccount(row)}
                    >
                      <Pencil className="size-3" aria-hidden />
                    </button>
                  ) : isAccount ? (
                    <Link
                      to="/manage/liabilities"
                      className="text-muted-foreground hover:text-foreground text-xs font-medium"
                      aria-label={`Manage ${name}`}
                    >
                      Manage
                    </Link>
                  ) : onEditRegistration ? (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground rounded p-0.5"
                      aria-label={`Edit ${name} registration`}
                      onClick={() => onEditRegistration(row)}
                    >
                      <Pencil className="size-3" aria-hidden />
                    </button>
                  ) : row.registry_id ? (
                    <Link
                      to={`/manage/bills/${row.registry_id}`}
                      className="text-muted-foreground hover:text-foreground text-xs font-medium"
                      aria-label={`Manage ${name}`}
                    >
                      Manage
                    </Link>
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
          {rows.length > 0 ? (
            <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
              <TableCell colSpan={2}>Subtotal</TableCell>
              <TableCell
                className="text-right tabular-nums"
                data-testid="liabilities-owed-subtotal"
              >
                {formatDisplayAmount(subtotals.owed)}
              </TableCell>
              <TableCell className="text-right">—</TableCell>
              <TableCell className="text-right">—</TableCell>
              <TableCell
                className="text-right tabular-nums"
                data-testid="liabilities-due-subtotal"
              >
                {formatDisplayAmount(subtotals.due)}
              </TableCell>
              <TableCell
                className="text-right tabular-nums"
                data-testid="liabilities-planned-cash-subtotal"
              >
                {formatDisplayAmount(subtotals.planned_cash)}
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
  )
}
