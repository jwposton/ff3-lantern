import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"
import {
  displayAmountDueInput,
  resolveAmountDueCommit,
  SOFT_AMOUNT_DUE_PLACEHOLDER,
} from "@/lib/paymentRunFormat"
import type { AmountDueRow } from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

type AmountDueInputProps = {
  row: AmountDueRow
  isPaid: boolean
  onCommit: (
    rowKey: string,
    body: { amount_due: string; clear_amount_due_override?: boolean },
  ) => Promise<void>
}

export function AmountDueInput({
  row,
  isPaid,
  onCommit,
}: AmountDueInputProps) {
  const [value, setValue] = useState(() => displayAmountDueInput(row))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) {
      setValue(displayAmountDueInput(row))
    }
  }, [
    row.amount_due,
    row.amount_due_override,
    row.amount_mode,
    row.planned_amount,
    row.account_id,
    row.row_key,
    focused,
  ])

  return (
    <Input
      className={cn(
        "ml-auto h-7 w-[4.5rem] px-1.5 text-right text-xs tabular-nums",
        isPaid && "font-semibold",
      )}
      inputMode="decimal"
      placeholder={SOFT_AMOUNT_DUE_PLACEHOLDER}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={async (event) => {
        setFocused(false)
        const commit = resolveAmountDueCommit(row, event.target.value)
        if (!commit) {
          setValue(displayAmountDueInput(row))
          return
        }
        await onCommit(row.row_key, commit)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur()
        }
      }}
    />
  )
}
