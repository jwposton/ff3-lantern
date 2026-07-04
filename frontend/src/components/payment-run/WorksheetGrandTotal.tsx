import { formatDisplayAmount } from "@/lib/formatDisplay"
import type { GrandTotals } from "@/lib/paymentRunApi"

type WorksheetGrandTotalProps = {
  grandTotals: GrandTotals
}

export function WorksheetGrandTotal({ grandTotals }: WorksheetGrandTotalProps) {
  return (
    <div
      className="bg-card space-y-3 rounded-lg border py-4 px-4 sm:px-6"
      data-testid="worksheet-grand-total"
    >
      <div className="flex flex-col items-baseline justify-between gap-1 sm:flex-row sm:gap-4">
        <span className="text-sm font-medium">Total owed</span>
        <span
          className="text-base font-semibold tabular-nums"
          data-testid="grand-total-owed"
        >
          {formatDisplayAmount(grandTotals.owed)}
        </span>
      </div>
      <div className="flex flex-col items-baseline justify-between gap-1 sm:flex-row sm:gap-4">
        <span className="text-sm font-medium">Total due</span>
        <span
          className="text-base font-semibold tabular-nums"
          data-testid="grand-total-due"
        >
          {formatDisplayAmount(grandTotals.due)}
        </span>
      </div>
      <div className="flex flex-col items-baseline justify-between gap-1 sm:flex-row sm:gap-4">
        <span className="text-sm font-medium">Total planned (cash)</span>
        <span
          className="text-base font-semibold tabular-nums"
          data-testid="grand-total-planned-cash"
        >
          {formatDisplayAmount(grandTotals.planned_cash)}
        </span>
      </div>
    </div>
  )
}
