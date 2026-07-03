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
  CreditCardRow,
  FundingBucketRollup,
  LiabilityRow,
  SectionSubtotals,
} from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

import { COMPACT_TABLE, countPaidRows } from "./BillsTable"

export { countPaidRows }

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
    parseAmount(row.owed) === 0 &&
    parseAmount(row.planned_amount) === 0 &&
    !row.planned_amount_override
  )
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

type LiabilitiesTableProps = {
  rows: LiabilityRow[]
  buckets: FundingBucketRollup[]
  creditCards: CreditCardRow[]
  subtotals: SectionSubtotals["liabilities"]
  onPlannedBlur: (
    rowKey: string,
    body: { planned_amount: string; clear_planned_override?: boolean },
  ) => Promise<void>
  onPaidChange: (row: LiabilityRow, paid: boolean) => Promise<void>
  onEditRegistration: (row: LiabilityRow) => void
  onEditAccount?: (row: LiabilityRow) => void
}

export function LiabilitiesTable({
  rows,
  buckets,
  creditCards,
  subtotals,
  onPlannedBlur,
  onPaidChange,
  onEditRegistration,
  onEditAccount,
}: LiabilitiesTableProps) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <Table className={COMPACT_TABLE}>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[8.75rem]">Name</TableHead>
              <TableHead className="w-[6.5rem] text-right">Balance owed</TableHead>
              <TableHead className="hidden w-[6rem] text-right lg:table-cell">
                Est. interest
              </TableHead>
              <TableHead className="hidden w-[5.5rem] text-right lg:table-cell">
                Remaining pmt
              </TableHead>
              <TableHead className="w-[7rem] text-right">Planned</TableHead>
              <TableHead className="w-[6rem]">Bucket</TableHead>
              <TableHead className="w-[4.5rem] text-center">Paid</TableHead>
              <TableHead className="w-12 text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isPaid = Boolean(row.paid_at)
              const name = displayName(row)
              const muted = isMutedIntermittent(row)
              const isAccount = isLiabilityAccount(row)
              const isCcRail = row.payment_rail === "credit_card"
              const viaCard = cardName(creditCards, row.credit_card_account_id)
              const showAutoDraft =
                isAccount && !row.planned_amount_override && parseAmount(row.planned_amount) > 0
              const showManual = row.planned_amount_override
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
                        {name}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {showAutoDraft ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Auto-draft
                          </Badge>
                        ) : null}
                        {showManual ? (
                          <Badge variant="outline" className="text-[10px]">
                            Manual
                          </Badge>
                        ) : null}
                        {isCcRail && viaCard ? (
                          <Badge
                            variant="outline"
                            className="text-muted-foreground text-[10px]"
                          >
                            Via {viaCard}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      muted && "text-muted-foreground",
                    )}
                  >
                    {formatDisplayAmount(row.owed)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {isAccount && row.est_interest
                      ? formatDisplayAmount(row.est_interest)
                      : "—"}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {isAccount && row.remaining_payments != null
                      ? String(row.remaining_payments)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <PlannedAmountInput
                      row={row}
                      isPaid={isPaid}
                      onCommit={onPlannedBlur}
                    />
                  </TableCell>
                  <TableCell className="max-w-[6rem] truncate text-muted-foreground">
                    {isCcRail
                      ? "—"
                      : bucketLabel(buckets, row.funding_bucket_key)}
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
                  <TableCell className="text-center">
                    {isAccount ? (
                      <div className="flex items-center justify-center gap-0.5">
                        {onEditAccount ? (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground rounded p-0.5"
                            aria-label={`Edit ${name}`}
                            onClick={() => onEditAccount(row)}
                          >
                            <Pencil className="size-3" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground rounded p-0.5"
                        aria-label={`Edit ${name} registration`}
                        onClick={() => onEditRegistration(row)}
                      >
                        <Pencil className="size-3" aria-hidden />
                      </button>
                    )}
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
              data-testid="liabilities-owed-subtotal"
            >
              {formatDisplayAmount(subtotals.owed)}
            </span>
          </div>
          <div className="flex justify-end gap-4">
            <span className="text-muted-foreground">Planned (cash) subtotal</span>
            <span
              className="min-w-[6rem] font-semibold tabular-nums"
              data-testid="liabilities-planned-cash-subtotal"
            >
              {formatDisplayAmount(subtotals.planned_cash)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
