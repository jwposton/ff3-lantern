import { AlertTriangle } from "lucide-react"

import type { FundingBucketRollup } from "@/lib/paymentRunApi"
import { formatDisplayAmount } from "@/lib/formatDisplay"

type ShortfallBannerProps = {
  buckets: FundingBucketRollup[]
}

export function ShortfallBanner({ buckets }: ShortfallBannerProps) {
  const negativeBuckets = buckets.filter((bucket) => {
    const remaining = Number.parseFloat(bucket.remaining)
    return Number.isFinite(remaining) && remaining < 0
  })

  return (
    <div
      className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
      data-testid="shortfall-banner"
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="space-y-2">
          <p className="font-medium text-destructive">Shortfall in cash accounts</p>
          <p className="text-sm">
            One or more cash accounts have negative remaining after planned outflows.
            Adjust planned payments or user balances before you pay.
          </p>
          {negativeBuckets.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {negativeBuckets.map((bucket) => (
                <li key={bucket.id}>
                  {bucket.label}: {formatDisplayAmount(bucket.remaining)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}
