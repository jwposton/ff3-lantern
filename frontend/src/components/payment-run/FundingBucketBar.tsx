import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  onAddBucket: () => void
  onEditBucket: (bucket: FundingBucketRollup) => void
  onBalanceBlur: (bucketId: string, value: string) => void
  onResetBalance: (bucketId: string) => void
}

function remainingClassName(value: string): string {
  const parsed = Number.parseFloat(value)
  if (Number.isFinite(parsed) && parsed < 0) {
    return "text-destructive font-semibold tabular-nums"
  }
  return "tabular-nums"
}

export function FundingBucketBar({
  buckets,
  totals,
  onAddBucket,
  onEditBucket,
  onBalanceBlur,
  onResetBalance,
}: FundingBucketBarProps) {
  return (
    <div
      className="sticky top-0 z-20 border-b bg-card/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-card/80"
      data-testid="funding-bucket-bar"
    >
      <div className="flex flex-nowrap gap-3 overflow-x-auto pb-2">
        {buckets.length === 0 ? (
          <div className="flex min-w-[280px] shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/30 p-8">
            <Button type="button" onClick={onAddBucket}>
              Add funding bucket
            </Button>
          </div>
        ) : (
          <>
            {buckets.map((bucket) => (
              <div
                key={bucket.id}
                className="min-w-[280px] shrink-0 rounded-lg border bg-muted/30 p-4"
              >
                <button
                  type="button"
                  className="mb-3 text-left text-sm font-semibold hover:underline"
                  onClick={() => onEditBucket(bucket)}
                >
                  {bucket.label}
                </button>
                <dl className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Reported</dt>
                    <dd className="tabular-nums">
                      {formatDisplayAmount(bucket.reported_balance)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">User balance</dt>
                    <dd>
                      <Input
                        className="h-8 w-[120px] text-right text-sm tabular-nums"
                        defaultValue={bucket.user_balance}
                        onBlur={(event) =>
                          onBalanceBlur(bucket.id, event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur()
                          }
                        }}
                      />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Planned outflows</dt>
                    <dd className="tabular-nums">
                      {formatDisplayAmount(bucket.planned_outflows)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Remaining</dt>
                    <dd className={remainingClassName(bucket.remaining)}>
                      {formatDisplayAmount(bucket.remaining)}
                    </dd>
                  </div>
                </dl>
                {bucket.user_balance_override ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="mt-2 h-auto px-0"
                    onClick={() => onResetBalance(bucket.id)}
                  >
                    Reset to reported
                  </Button>
                ) : null}
              </div>
            ))}
            <div className="flex min-w-[120px] shrink-0 items-center justify-center">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Add funding bucket"
                onClick={onAddBucket}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      {buckets.length > 0 ? (
        <div className="mt-1 grid gap-3 border-t pt-3 sm:grid-cols-3">
          <div className="flex flex-col gap-0.5 sm:items-end">
            <span className="text-muted-foreground text-xs">Total reported</span>
            <span className="text-sm font-medium tabular-nums">
              {formatDisplayAmount(totals.reported_balance)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 sm:items-end">
            <span className="text-muted-foreground text-xs">Total user</span>
            <span className="text-sm font-medium tabular-nums">
              {formatDisplayAmount(totals.user_balance)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 sm:items-end">
            <span className="text-muted-foreground text-xs">Total remaining</span>
            <span
              className={cn(
                "text-sm font-medium",
                remainingClassName(totals.remaining),
              )}
            >
              {formatDisplayAmount(totals.remaining)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
