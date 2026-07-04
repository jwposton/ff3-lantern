import { Pencil } from "lucide-react"

import { AmountDueInput } from "@/components/payment-run/AmountDueInput"
import { PlannedAmountInput } from "@/components/payment-run/PlannedAmountInput"
import {
  ACTIONS_CELL_CLASS,
  ACTIONS_HEAD_CLASS,
  COMPACT_TABLE,
  WorksheetNameLink,
  bucketLabel,
  cardName,
  formatPmtSrcRail,
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
import { buildFireflyBillUrl } from "@/lib/fireflyLinks"
import type {
  BillRow,
  CreditCardRow,
  FundingBucketRollup,
  SectionSubtotals,
} from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

export { COMPACT_TABLE }

type PaidRow = { paid_at: string | null }

export function countPaidRows<T extends PaidRow>(rows: T[]): number {
  return rows.filter((row) => Boolean(row.paid_at)).length
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isMutedIntermittent(row: BillRow): boolean {
  return (
    row.amount_mode === "intermittent" &&
    parseAmount(row.amount_due) === 0 &&
    parseAmount(row.planned_amount) === 0 &&
    !row.planned_amount_override &&
    !row.amount_due_override
  )
}

type BillsTableProps = {
  rows: BillRow[]
  buckets: FundingBucketRollup[]
  creditCards: CreditCardRow[]
  subtotals: SectionSubtotals["bills"]
  fireflyBaseUrl?: string
  onPlannedBlur: (
    rowKey: string,
    body: { planned_amount: string; clear_planned_override?: boolean },
  ) => Promise<void>
  onAmountDueBlur: (
    rowKey: string,
    body: { amount_due: string; clear_amount_due_override?: boolean },
  ) => Promise<void>
  onPaidChange: (row: BillRow, paid: boolean) => Promise<void>
  onEditRegistration: (row: BillRow) => void
}

export function BillsTable({
  rows,
  buckets,
  creditCards,
  subtotals,
  fireflyBaseUrl,
  onPlannedBlur,
  onAmountDueBlur,
  onPaidChange,
  onEditRegistration,
}: BillsTableProps) {
  const paidCount = countPaidRows(rows)

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className={COMPACT_TABLE}>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[8.75rem]">Bill</TableHead>
            <TableHead className="w-[5.5rem]">Pmt Src</TableHead>
            <TableHead className="w-[6rem]">Bucket</TableHead>
            <TableHead className="w-[6rem] text-right">Amt. Due</TableHead>
            <TableHead className="w-[7rem] text-right">Planned</TableHead>
            <TableHead className="w-[4.5rem] text-center">Paid</TableHead>
            <TableHead className={ACTIONS_HEAD_CLASS}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isPaid = Boolean(row.paid_at)
            const billName = row.row_label ?? `Bill ${row.registry_id}`
            const muted = isMutedIntermittent(row)
            const isCcRail = row.payment_rail === "credit_card"
            const viaCard = cardName(creditCards, row.credit_card_account_id)
            const fireflyBillUrl = buildFireflyBillUrl(
              fireflyBaseUrl,
              row.firefly_bill_id,
            )
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
                      href={fireflyBillUrl}
                      muted={muted}
                      paid={isPaid}
                    >
                      {billName}
                    </WorksheetNameLink>
                    {isCcRail && viaCard ? (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground shrink-0 text-[10px]"
                      >
                        Via {viaCard}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatPmtSrcRail(row)}
                </TableCell>
                <TableCell className="max-w-[6rem] truncate text-muted-foreground">
                  {isCcRail
                    ? "—"
                    : bucketLabel(buckets, row.funding_bucket_key)}
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
                    aria-label={`Mark ${billName} paid`}
                    checked={isPaid}
                    onChange={(event) =>
                      void onPaidChange(row, event.target.checked)
                    }
                  />
                </TableCell>
                <TableCell className={ACTIONS_CELL_CLASS}>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground rounded p-0.5"
                    aria-label={`Edit ${billName} registration`}
                    onClick={() => onEditRegistration(row)}
                  >
                    <Pencil className="size-3" aria-hidden />
                  </button>
                </TableCell>
              </TableRow>
            )
          })}
          {rows.length > 0 ? (
            <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
              <TableCell colSpan={3}>Subtotal</TableCell>
              <TableCell
                className="text-right tabular-nums"
                data-testid="bills-due-subtotal"
              >
                {formatDisplayAmount(subtotals.due)}
              </TableCell>
              <TableCell
                className="text-right tabular-nums"
                data-testid="bills-planned-cash-subtotal"
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
