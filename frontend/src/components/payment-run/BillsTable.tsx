import { Pencil } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { PlannedAmountInput } from "@/components/payment-run/PlannedAmountInput"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import type {
  BillRow,
  CreditCardRow,
  FundingBucketRollup,
  SectionSubtotals,
} from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

export const COMPACT_TABLE =
  "text-xs [&_th]:h-8 [&_th]:px-2 [&_th]:py-1 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-xs [&_td]:min-h-0"

type PaidRow = { paid_at: string | null }

export function countPaidRows<T extends PaidRow>(rows: T[]): number {
  return rows.filter((row) => Boolean(row.paid_at)).length
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function bucketLabel(
  buckets: FundingBucketRollup[],
  bucketKey: string | null | undefined,
): string {
  if (!bucketKey) return "—"
  return buckets.find((bucket) => bucket.id === bucketKey)?.label ?? "—"
}

function cardName(
  creditCards: CreditCardRow[],
  accountId: string | null | undefined,
): string | null {
  if (!accountId) return null
  const card = creditCards.find((row) => row.account_id === accountId)
  return card?.name ?? accountId
}

function isMutedIntermittent(row: BillRow): boolean {
  return (
    row.amount_mode === "intermittent" &&
    parseAmount(row.owed) === 0 &&
    parseAmount(row.planned_amount) === 0 &&
    !row.planned_amount_override
  )
}

type BillsTableProps = {
  rows: BillRow[]
  buckets: FundingBucketRollup[]
  creditCards: CreditCardRow[]
  subtotals: SectionSubtotals["bills"]
  onPlannedBlur: (
    rowKey: string,
    body: { planned_amount: string; clear_planned_override?: boolean },
  ) => Promise<void>
  onPaidChange: (row: BillRow, paid: boolean) => Promise<void>
  onEditRegistration: (row: BillRow) => void
}

export function BillsTable({
  rows,
  buckets,
  creditCards,
  subtotals,
  onPlannedBlur,
  onPaidChange,
  onEditRegistration,
}: BillsTableProps) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <Table className={COMPACT_TABLE}>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[8.75rem]">Bill</TableHead>
              <TableHead className="w-[5.5rem]">Rail</TableHead>
              <TableHead className="w-[6rem]">Bucket</TableHead>
              <TableHead className="w-[6rem] text-right">Owed</TableHead>
              <TableHead className="w-[7rem] text-right">Planned</TableHead>
              <TableHead className="w-[4.5rem] text-center">Paid</TableHead>
              <TableHead className="w-12 text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isPaid = Boolean(row.paid_at)
              const billName = row.row_label ?? `Bill ${row.registry_id}`
              const muted = isMutedIntermittent(row)
              const isCcRail = row.payment_rail === "credit_card"
              const viaCard = cardName(creditCards, row.credit_card_account_id)
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
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className={cn(
                          "truncate font-medium",
                          muted && "text-muted-foreground",
                          isPaid && "font-semibold",
                        )}
                      >
                        {billName}
                      </span>
                      {isCcRail && viaCard ? (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground w-fit text-[10px]"
                        >
                          Via {viaCard}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {isCcRail ? "Card" : "Bank"}
                  </TableCell>
                  <TableCell className="max-w-[6rem] truncate text-muted-foreground">
                    {isCcRail
                      ? "—"
                      : bucketLabel(buckets, row.funding_bucket_key)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      muted && "text-muted-foreground",
                    )}
                  >
                    {formatDisplayAmount(row.owed)}
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
                  <TableCell className="text-center">
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
          </TableBody>
        </Table>
      </div>

      {rows.length > 0 ? (
        <div className="space-y-1 text-right text-sm">
          <div className="flex justify-end gap-4">
            <span className="text-muted-foreground">Owed subtotal</span>
            <span
              className="min-w-[6rem] font-semibold tabular-nums"
              data-testid="bills-owed-subtotal"
            >
              {formatDisplayAmount(subtotals.owed)}
            </span>
          </div>
          <div className="flex justify-end gap-4">
            <span className="text-muted-foreground">Planned (cash) subtotal</span>
            <span
              className="min-w-[6rem] font-semibold tabular-nums"
              data-testid="bills-planned-cash-subtotal"
            >
              {formatDisplayAmount(subtotals.planned_cash)}
            </span>
          </div>
          {subtotals.on_card_informational ? (
            <div className="text-muted-foreground flex justify-end gap-4 text-sm">
              <span>On card (informational)</span>
              <span
                className="min-w-[6rem] tabular-nums"
                data-testid="bills-on-card-informational"
              >
                {formatDisplayAmount(subtotals.on_card_informational)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
