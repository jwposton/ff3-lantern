import { UserBalanceInput } from "@/components/payment-run/UserBalanceInput"
import { COMPACT_TABLE } from "@/components/payment-run/worksheetTableUtils"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import type { FundingBucketRollup } from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

type FundingBucketBarProps = {
  buckets: FundingBucketRollup[]
  totals: {
    reported_balance: string
    user_balance: string
    remaining: string
  }
  accountNameById: Map<string, string>
  onAddBucket: () => void
  onEditBucket: (bucket: FundingBucketRollup) => void
  onBalanceBlur: (
    bucketId: string,
    body: { user_balance: string; reset_to_reported?: boolean },
  ) => Promise<void>
  onResetBalance: (bucketId: string) => void
}

function remainingClassName(value: string): string {
  const parsed = Number.parseFloat(value)
  if (Number.isFinite(parsed) && parsed < 0) {
    return "text-destructive font-semibold tabular-nums"
  }
  return "tabular-nums"
}

function formatAccountLabels(
  accountIds: string[] | undefined,
  accountNameById: Map<string, string>,
): string | null {
  if (!accountIds?.length) {
    return null
  }
  return accountIds
    .map((id) => accountNameById.get(id) ?? `Account ${id}`)
    .join(", ")
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sumPlannedOutflows(buckets: FundingBucketRollup[]): string {
  const total = buckets.reduce(
    (sum, bucket) => sum + parseAmount(bucket.planned_outflows),
    0,
  )
  return total.toFixed(2)
}

export function FundingBucketBar({
  buckets,
  totals,
  accountNameById,
  onAddBucket,
  onEditBucket,
  onBalanceBlur,
  onResetBalance,
}: FundingBucketBarProps) {
  const plannedOutflowsTotal = sumPlannedOutflows(buckets)

  return (
    <div className="space-y-2" data-testid="funding-bucket-bar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Funding buckets</h2>
        {buckets.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddBucket}
          >
            Add bucket
          </Button>
        ) : null}
      </div>

      {buckets.length === 0 ? (
        <div className="flex items-center justify-center rounded-md border border-dashed bg-muted/30 px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={onAddBucket}>
            Add bucket
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className={COMPACT_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[8rem]">Bucket</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">User balance</TableHead>
                <TableHead className="text-right">Planned outflow</TableHead>
                <TableHead className="text-right">Remaining balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((bucket) => {
                const accountLabels = formatAccountLabels(
                  bucket.firefly_account_ids,
                  accountNameById,
                )
                return (
                <TableRow key={bucket.id}>
                  <TableCell className="max-w-[14rem]">
                    <div className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        className="shrink-0 text-left font-medium hover:underline"
                        onClick={() => onEditBucket(bucket)}
                      >
                        {bucket.label}
                      </button>
                      {accountLabels ? (
                        <span
                          className="text-muted-foreground min-w-0 truncate text-[10px]"
                          title={accountLabels}
                        >
                          · {accountLabels}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDisplayAmount(bucket.reported_balance)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <UserBalanceInput
                        bucket={bucket}
                        onCommit={onBalanceBlur}
                      />
                      {bucket.user_balance_override ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto px-0 text-[10px]"
                          onClick={() => onResetBalance(bucket.id)}
                        >
                          Reset to reported
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDisplayAmount(bucket.planned_outflows)}
                  </TableCell>
                  <TableCell
                    className={cn("text-right", remainingClassName(bucket.remaining))}
                  >
                    {formatDisplayAmount(bucket.remaining)}
                  </TableCell>
                </TableRow>
                )
              })}
              <TableRow
                className="bg-muted/40 font-semibold hover:bg-muted/40"
                data-testid="funding-bucket-totals-row"
              >
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDisplayAmount(totals.reported_balance)}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-testid="funding-bucket-total-user"
                >
                  {formatDisplayAmount(totals.user_balance)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDisplayAmount(plannedOutflowsTotal)}
                </TableCell>
                <TableCell
                  className={cn("text-right", remainingClassName(totals.remaining))}
                  data-testid="funding-bucket-total-remaining"
                >
                  {formatDisplayAmount(totals.remaining)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
