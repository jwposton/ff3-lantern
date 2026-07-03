import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"
import {
  displayPlannedAmountInput,
  resolvePlannedAmountCommit,
  SOFT_PLANNED_AMOUNT_PLACEHOLDER,
} from "@/lib/paymentRunFormat"
import type { CreditCardRow } from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

type PlannedAmountInputProps = {
  row: CreditCardRow
  isPaid: boolean
  onCommit: (
    rowKey: string,
    body: { planned_amount: string; clear_planned_override?: boolean },
  ) => Promise<void>
}

export function PlannedAmountInput({
  row,
  isPaid,
  onCommit,
}: PlannedAmountInputProps) {
  const [value, setValue] = useState(() => displayPlannedAmountInput(row))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) {
      setValue(displayPlannedAmountInput(row))
    }
  }, [row.planned_amount, row.planned_amount_override, row.row_key, focused])

  return (
    <Input
      className={cn(
        "ml-auto h-7 w-[4.5rem] px-1.5 text-right text-xs tabular-nums",
        isPaid && "font-semibold",
      )}
      inputMode="decimal"
      placeholder={SOFT_PLANNED_AMOUNT_PLACEHOLDER}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={async (event) => {
        setFocused(false)
        const commit = resolvePlannedAmountCommit(row, event.target.value)
        if (!commit) {
          setValue(displayPlannedAmountInput(row))
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
