import { useMemo, useState } from "react"
import { MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import type { CreditCardRow, FundingBucketRollup } from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

type CreditCardsTableProps = {
  rows: CreditCardRow[]
  buckets: FundingBucketRollup[]
  onPlannedBlur: (rowKey: string, value: string) => Promise<void>
  onPaidChange: (row: CreditCardRow, paid: boolean) => Promise<void>
  onBucketChange: (accountId: string, bucketKey: string | null) => Promise<void>
  onExclude: (row: CreditCardRow) => Promise<void>
}

function formatUtilPercent(
  owed: string,
  creditLimit: string | null | undefined,
): string {
  if (!creditLimit) return "—"
  const limit = Number.parseFloat(creditLimit)
  if (!Number.isFinite(limit) || limit <= 0) return "—"
  const owedAmount = Number.parseFloat(owed)
  if (!Number.isFinite(owedAmount)) return "—"
  return `${((owedAmount / limit) * 100).toFixed(1)}%`
}

function selectClassName(): string {
  return "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-8 w-full rounded-md border px-2 py-0.5 text-xs shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"
}

export function CreditCardsTable({
  rows,
  buckets,
  onPlannedBlur,
  onPaidChange,
  onBucketChange,
  onExclude,
}: CreditCardsTableProps) {
  const [excludeRow, setExcludeRow] = useState<CreditCardRow | null>(null)
  const [excluding, setExcluding] = useState(false)

  const subtotal = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const amount = Number.parseFloat(row.planned_amount)
        return sum + (Number.isFinite(amount) ? amount : 0)
      }, 0),
    [rows],
  )

  async function confirmExclude() {
    if (!excludeRow) return
    setExcluding(true)
    try {
      await onExclude(excludeRow)
      setExcludeRow(null)
    } finally {
      setExcluding(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Card</TableHead>
              <TableHead className="text-right">New</TableHead>
              <TableHead className="text-right">Interest accrued</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead className="text-right">Owed</TableHead>
              <TableHead className="text-right">Planned</TableHead>
              <TableHead className="text-right">Util %</TableHead>
              <TableHead>Bucket</TableHead>
              <TableHead className="text-center">Paid</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isPaid = Boolean(row.paid_at)
              const cardName = row.name ?? row.account_id
              return (
                <TableRow
                  key={row.row_key}
                  data-state={isPaid ? "paid" : undefined}
                  className={cn(
                    isPaid &&
                      "bg-emerald-50/80 font-semibold dark:bg-emerald-950/25",
                  )}
                >
                  <TableCell className="max-w-[160px] truncate" title={cardName}>
                    {cardName}
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
                  <TableCell className="text-right tabular-nums">
                    {formatDisplayAmount(row.owed)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      className={cn(
                        "ml-auto h-8 w-[112px] text-right text-sm tabular-nums",
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
                  <TableCell className="text-right tabular-nums">
                    {formatUtilPercent(row.owed, row.credit_limit)}
                  </TableCell>
                  <TableCell>
                    <select
                      className={selectClassName()}
                      value={row.funding_bucket_key ?? ""}
                      onChange={(event) => {
                        const value = event.target.value
                        void onBucketChange(
                          row.account_id,
                          value ? value : null,
                        )
                      }}
                    >
                      <option value="">Unassigned</option>
                      {buckets.map((bucket) => (
                        <option key={bucket.id} value={bucket.id}>
                          {bucket.label}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="text-center">
                    <input
                      type="checkbox"
                      role="checkbox"
                      aria-label={`Mark ${cardName} paid`}
                      checked={isPaid}
                      onChange={(event) =>
                        void onPaidChange(row, event.target.checked)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Actions for ${cardName}`}
                      onClick={() => setExcludeRow(row)}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end gap-3 text-sm">
        <span className="text-muted-foreground">Planned payments subtotal</span>
        <span className="font-semibold tabular-nums" data-testid="cc-planned-subtotal">
          {formatDisplayAmount(subtotal)}
        </span>
      </div>

      <Sheet open={excludeRow !== null} onOpenChange={(open) => !open && setExcludeRow(null)}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Exclude {excludeRow?.name ?? excludeRow?.account_id}?</SheetTitle>
            <SheetDescription>
              This card will disappear from the worksheet until you include it
              again. Planned amount for this month is preserved in the sidecar.
            </SheetDescription>
          </SheetHeader>
          <SheetFooter className="gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => setExcludeRow(null)}
              disabled={excluding}
            >
              Keep on worksheet
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void confirmExclude()}
              disabled={excluding}
            >
              Exclude
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
