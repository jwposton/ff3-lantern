import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"
import {
  displayUserBalanceInput,
  resolveUserBalanceCommit,
  userBalancePlaceholder,
} from "@/lib/paymentRunFormat"
import type { FundingBucketRollup } from "@/lib/paymentRunApi"

type UserBalanceInputProps = {
  bucket: FundingBucketRollup
  onCommit: (
    bucketId: string,
    body: { user_balance: string; reset_to_reported?: boolean },
  ) => Promise<void>
}

export function UserBalanceInput({ bucket, onCommit }: UserBalanceInputProps) {
  const [value, setValue] = useState(() => displayUserBalanceInput(bucket))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) {
      setValue(displayUserBalanceInput(bucket))
    }
  }, [
    bucket.id,
    bucket.reported_balance,
    bucket.user_balance,
    bucket.user_balance_override,
    focused,
  ])

  return (
    <Input
      className="h-8 w-[120px] text-right text-sm tabular-nums"
      inputMode="decimal"
      placeholder={userBalancePlaceholder(bucket)}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={async (event) => {
        setFocused(false)
        const commit = resolveUserBalanceCommit(bucket, event.target.value)
        if (!commit) {
          setValue(displayUserBalanceInput(bucket))
          return
        }
        await onCommit(bucket.id, commit)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur()
        }
      }}
    />
  )
}
