import type { ReactNode } from "react"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import type { GrandTotals } from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

type WorksheetGrandTotalProps = {
  grandTotals: GrandTotals
}

type SubLineProps = {
  label: string
  amount: string
  indent?: 1 | 2
  testId?: string
}

function SubLine({ label, amount, indent = 1, testId }: SubLineProps) {
  return (
    <div
      className={cn(
        "text-muted-foreground flex flex-col items-baseline justify-between gap-1 sm:flex-row sm:gap-4",
        indent === 1 && "pl-3",
        indent === 2 && "pl-6",
      )}
    >
      <span className="text-xs">{label}</span>
      <span className="text-xs tabular-nums" data-testid={testId}>
        {formatDisplayAmount(amount)}
      </span>
    </div>
  )
}

type HeadlineRowProps = {
  label: string
  amount: string
  testId: string
  children?: ReactNode
}

function HeadlineRow({ label, amount, testId, children }: HeadlineRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex flex-col items-baseline justify-between gap-1 sm:flex-row sm:gap-4">
        <span className="text-sm font-medium">{label}</span>
        <span
          className="text-base font-semibold tabular-nums"
          data-testid={testId}
        >
          {formatDisplayAmount(amount)}
        </span>
      </div>
      {children}
    </div>
  )
}

export function WorksheetGrandTotal({ grandTotals }: WorksheetGrandTotalProps) {
  const { breakdown } = grandTotals

  return (
    <div
      className="bg-card space-y-3 rounded-lg border py-4 px-4 sm:px-6"
      data-testid="worksheet-grand-total"
    >
      <HeadlineRow
        label="Total owed"
        amount={grandTotals.owed}
        testId="grand-total-owed"
      >
        <SubLine
          label="Liabilities"
          amount={breakdown.owed.liabilities}
          testId="grand-total-owed-liabilities"
        />
        {breakdown.owed.real_estate ? (
          <SubLine
            label="Real estate"
            amount={breakdown.owed.real_estate}
            indent={2}
            testId="grand-total-owed-real-estate"
          />
        ) : null}
        {breakdown.owed.loans ? (
          <SubLine
            label="Loans"
            amount={breakdown.owed.loans}
            indent={2}
            testId="grand-total-owed-loans"
          />
        ) : null}
        <SubLine
          label="Revolving (CC)"
          amount={breakdown.owed.revolving}
          testId="grand-total-owed-revolving"
        />
      </HeadlineRow>

      <HeadlineRow
        label="Total due"
        amount={grandTotals.due}
        testId="grand-total-due"
      >
        <SubLine
          label="Cash (bank)"
          amount={breakdown.due.cash}
          testId="grand-total-due-cash"
        />
        <SubLine
          label="Credit card"
          amount={breakdown.due.credit}
          testId="grand-total-due-credit"
        />
      </HeadlineRow>

      <HeadlineRow
        label="Total planned"
        amount={grandTotals.planned_total}
        testId="grand-total-planned"
      >
        <SubLine
          label="Cash"
          amount={breakdown.planned.cash}
          testId="grand-total-planned-cash"
        />
        <SubLine
          label="Credit"
          amount={breakdown.planned.credit}
          testId="grand-total-planned-credit"
        />
      </HeadlineRow>
    </div>
  )
}
