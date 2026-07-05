import { ChevronDown, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import type {
  CreditCardDuePlannedRow,
  DuePlannedRailSection,
  GrandTotals,
} from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

type WorksheetGrandTotalProps = {
  grandTotals: GrandTotals
}

function isZeroAmount(value: string | null | undefined): boolean {
  if (value == null) return true
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed === 0
}

function isAllZero(...values: (string | null | undefined)[]): boolean {
  return values.every((value) => isZeroAmount(value))
}

type AmountProps = {
  value: string
  testId: string
  bold?: boolean
  muted?: boolean
}

function Amount({ value, testId, bold, muted = !bold }: AmountProps) {
  return (
    <span
      className={cn(
        "tabular-nums",
        bold && "font-semibold",
        muted && "text-muted-foreground",
      )}
      data-testid={testId}
    >
      {formatDisplayAmount(value)}
    </span>
  )
}

function CollapseToggle({
  label,
  expanded,
  onToggle,
  className,
}: {
  label: string
  expanded: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-left",
        className,
      )}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? (
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="truncate">{label}</span>
    </button>
  )
}

function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  function isExpanded(key: string) {
    return !collapsed.has(key)
  }

  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return { isExpanded, toggle }
}

type OwedChildRow = {
  key: string
  label: string
  amount: string
  testId: string
}

type OwedGroup = {
  key: string
  label: string
  amount: string
  testId: string
  children: OwedChildRow[]
}

function buildOwedGroups(grandTotals: GrandTotals): {
  total: string
  groups: OwedGroup[]
} {
  const { breakdown } = grandTotals
  const groups: OwedGroup[] = []

  const liabilityChildren: OwedChildRow[] = []
  if (breakdown.owed.real_estate && !isZeroAmount(breakdown.owed.real_estate)) {
    liabilityChildren.push({
      key: "real-estate",
      label: "Real estate",
      amount: breakdown.owed.real_estate,
      testId: "grand-total-real-estate-owed",
    })
  }
  if (breakdown.owed.loans && !isZeroAmount(breakdown.owed.loans)) {
    liabilityChildren.push({
      key: "loans",
      label: "Loans",
      amount: breakdown.owed.loans,
      testId: "grand-total-loans-owed",
    })
  }

  if (
    !isZeroAmount(breakdown.owed.liabilities) ||
    liabilityChildren.length > 0
  ) {
    groups.push({
      key: "liabilities",
      label: "Liabilities",
      amount: breakdown.owed.liabilities,
      testId: "grand-total-liabilities-owed",
      children: liabilityChildren,
    })
  }

  if (!isZeroAmount(breakdown.owed.revolving)) {
    groups.push({
      key: "revolving",
      label: "Revolving (CC)",
      amount: breakdown.owed.revolving,
      testId: "grand-total-revolving-owed",
      children: [],
    })
  }

  return { total: grandTotals.owed, groups }
}

type MonthChildRow = {
  key: string
  label: string
  due: string
  planned: string
  dueTestId: string
  plannedTestId: string
  children?: MonthChildRow[]
}

type MonthGroup = {
  key: string
  label: string
  due: string
  planned: string
  dueTestId: string
  plannedTestId: string
  children: MonthChildRow[]
}

type DuePlannedSections = GrandTotals["breakdown"]["due_planned"]
type DuePlannedRail = keyof DuePlannedRailSection

const DUE_PLANNED_CHILD_SPECS: {
  sectionKey: "liabilities" | "bills" | "credit_card_pmts"
  key: string
  label: string
  testIdPrefix: string
  cardBreakdown?: boolean
}[] = [
  {
    sectionKey: "liabilities",
    key: "liabilities",
    label: "Liabilities",
    testIdPrefix: "liabilities",
    cardBreakdown: true,
  },
  {
    sectionKey: "bills",
    key: "bills",
    label: "Bills",
    testIdPrefix: "bills",
    cardBreakdown: true,
  },
  {
    sectionKey: "credit_card_pmts",
    key: "credit-card-pmts",
    label: "Credit card pmts",
    testIdPrefix: "credit-card-pmts",
  },
]

function buildCreditCardBreakdownChildren(
  cards: CreditCardDuePlannedRow[],
  testIdPrefix: string,
): MonthChildRow[] {
  return cards
    .filter((card) => !isAllZero(card.due, card.planned))
    .map((card) => {
      const key = card.account_id ?? "unassigned"
      return {
        key: `card-${key}`,
        label: card.name,
        due: card.due,
        planned: card.planned,
        dueTestId: `grand-total-${testIdPrefix}-card-${key}-due`,
        plannedTestId: `grand-total-${testIdPrefix}-card-${key}-planned`,
      }
    })
}

function buildDuePlannedRailChildren(
  sections: DuePlannedSections,
  rail: DuePlannedRail,
): MonthChildRow[] {
  const children: MonthChildRow[] = []
  for (const spec of DUE_PLANNED_CHILD_SPECS) {
    const section = sections[spec.sectionKey]
    const { due, planned } = section[rail]
    if (isAllZero(due, planned)) {
      continue
    }
    const cardChildren =
      rail === "credit" && spec.cardBreakdown && "by_credit_card" in section
        ? buildCreditCardBreakdownChildren(
            section.by_credit_card ?? [],
            spec.testIdPrefix,
          )
        : []
    children.push({
      key: spec.key,
      label: spec.label,
      due,
      planned,
      dueTestId: `grand-total-${spec.testIdPrefix}-${rail}-due`,
      plannedTestId: `grand-total-${spec.testIdPrefix}-${rail}-planned`,
      children: cardChildren.length > 0 ? cardChildren : undefined,
    })
  }
  return children
}

function buildMonthGroups(grandTotals: GrandTotals): {
  totalDue: string
  totalPlanned: string
  groups: MonthGroup[]
} {
  const { breakdown } = grandTotals
  const { due_planned: sections } = breakdown

  const cashChildren = buildDuePlannedRailChildren(sections, "cash")
  const creditChildren = buildDuePlannedRailChildren(sections, "credit")

  const groups: MonthGroup[] = []
  if (
    !isAllZero(breakdown.due.cash, breakdown.planned.cash) ||
    cashChildren.length > 0
  ) {
    groups.push({
      key: "cash",
      label: "Cash (bank)",
      due: breakdown.due.cash,
      planned: breakdown.planned.cash,
      dueTestId: "grand-total-cash-due",
      plannedTestId: "grand-total-cash-planned",
      children: cashChildren,
    })
  }
  if (
    !isAllZero(breakdown.due.credit, breakdown.planned.credit) ||
    creditChildren.length > 0
  ) {
    groups.push({
      key: "credit",
      label: "Credit card",
      due: breakdown.due.credit,
      planned: breakdown.planned.credit,
      dueTestId: "grand-total-credit-due",
      plannedTestId: "grand-total-credit-planned",
      children: creditChildren,
    })
  }

  return {
    totalDue: grandTotals.due,
    totalPlanned: grandTotals.planned_total,
    groups,
  }
}

function OwedCard({ grandTotals }: { grandTotals: GrandTotals }) {
  const { total, groups } = useMemo(
    () => buildOwedGroups(grandTotals),
    [grandTotals],
  )
  const { isExpanded, toggle } = useCollapsedGroups()

  return (
    <Card className="gap-0 py-0 shadow-none" data-testid="grand-total-owed-card">
      <CardHeader className="border-b px-4 py-3">
        <CardTitle className="text-sm font-semibold">Balances owed</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div
          className="text-muted-foreground grid grid-cols-[1fr_7.5rem] gap-x-3 border-b px-4 py-2 text-xs font-medium"
          aria-hidden
        >
          <span />
          <span className="text-right">Owed</span>
        </div>
        <ul className="divide-y">
          <li className="bg-muted/40 grid grid-cols-[1fr_7.5rem] items-baseline gap-x-3 px-4 py-2.5 text-sm font-semibold">
            <span>Total owed</span>
            <span className="text-right">
              <Amount value={total} testId="grand-total-owed" bold />
            </span>
          </li>
          {groups.map((group) => {
            const expanded = isExpanded(group.key)
            const collapsible = group.children.length > 0
            return (
              <li key={group.key}>
                <div
                  className={cn(
                    "grid grid-cols-[1fr_7.5rem] items-baseline gap-x-3 px-4 py-2.5 text-sm",
                    collapsible && "text-muted-foreground text-xs",
                  )}
                >
                  {collapsible ? (
                    <CollapseToggle
                      label={group.label}
                      expanded={expanded}
                      onToggle={() => toggle(group.key)}
                    />
                  ) : (
                    <span>{group.label}</span>
                  )}
                  <span className="text-right">
                    <Amount value={group.amount} testId={group.testId} />
                  </span>
                </div>
                {collapsible && expanded ? (
                  <ul className="border-t">
                    {group.children.map((child) => (
                      <li
                        key={child.key}
                        className="grid grid-cols-[1fr_7.5rem] items-baseline gap-x-3 py-2 pr-4 pl-10 text-xs"
                      >
                        <span className="text-muted-foreground">{child.label}</span>
                        <span className="text-right">
                          <Amount value={child.amount} testId={child.testId} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function MonthCard({ grandTotals }: { grandTotals: GrandTotals }) {
  const { totalDue, totalPlanned, groups } = useMemo(
    () => buildMonthGroups(grandTotals),
    [grandTotals],
  )
  const { isExpanded, toggle } = useCollapsedGroups()

  return (
    <Card className="gap-0 py-0 shadow-none" data-testid="grand-total-month-card">
      <CardHeader className="border-b px-4 py-3">
        <CardTitle className="text-sm font-semibold">Due &amp; planned</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div
          className="text-muted-foreground grid grid-cols-[1fr_6.5rem_6.5rem] gap-x-3 border-b px-4 py-2 text-xs font-medium"
          aria-hidden
        >
          <span />
          <span className="text-right">Due</span>
          <span className="text-right">Planned</span>
        </div>
        <ul className="divide-y">
          <li className="bg-muted/40 grid grid-cols-[1fr_6.5rem_6.5rem] items-baseline gap-x-3 px-4 py-2.5 text-sm font-semibold">
            <span>Total</span>
            <span className="text-right">
              <Amount value={totalDue} testId="grand-total-due" bold />
            </span>
            <span className="text-right">
              <Amount value={totalPlanned} testId="grand-total-planned" bold />
            </span>
          </li>
          {groups.map((group) => {
            const expanded = isExpanded(group.key)
            const collapsible = group.children.length > 0
            return (
              <li key={group.key}>
                <div className="grid grid-cols-[1fr_6.5rem_6.5rem] items-baseline gap-x-3 px-4 py-2.5 text-sm">
                  {collapsible ? (
                    <CollapseToggle
                      label={group.label}
                      expanded={expanded}
                      onToggle={() => toggle(group.key)}
                      className="font-medium"
                    />
                  ) : (
                    <span className="font-medium">{group.label}</span>
                  )}
                  <span className="text-right">
                    <Amount
                      value={group.due}
                      testId={group.dueTestId}
                      bold={!collapsible}
                    />
                  </span>
                  <span className="text-right">
                    <Amount
                      value={group.planned}
                      testId={group.plannedTestId}
                      bold={!collapsible}
                    />
                  </span>
                </div>
                {collapsible && expanded ? (
                  <ul className="border-t">
                    {group.children.map((child) => {
                      const childKey = `${group.key}-${child.key}`
                      const childExpanded = isExpanded(childKey)
                      const childCollapsible = (child.children?.length ?? 0) > 0
                      return (
                        <li key={child.key}>
                          <div
                            className={cn(
                              "grid grid-cols-[1fr_6.5rem_6.5rem] items-baseline gap-x-3 py-2 pr-4 pl-10 text-xs",
                              childCollapsible && "text-muted-foreground",
                            )}
                          >
                            {childCollapsible ? (
                              <CollapseToggle
                                label={child.label}
                                expanded={childExpanded}
                                onToggle={() => toggle(childKey)}
                              />
                            ) : (
                              <span className="text-muted-foreground">
                                {child.label}
                              </span>
                            )}
                            <span className="text-right">
                              <Amount value={child.due} testId={child.dueTestId} />
                            </span>
                            <span className="text-right">
                              <Amount
                                value={child.planned}
                                testId={child.plannedTestId}
                              />
                            </span>
                          </div>
                          {childCollapsible && childExpanded ? (
                            <ul className="border-t">
                              {child.children!.map((grandchild) => (
                                <li
                                  key={grandchild.key}
                                  className="grid grid-cols-[1fr_6.5rem_6.5rem] items-baseline gap-x-3 py-2 pr-4 pl-16 text-xs"
                                >
                                  <span className="text-muted-foreground">
                                    {grandchild.label}
                                  </span>
                                  <span className="text-right">
                                    <Amount
                                      value={grandchild.due}
                                      testId={grandchild.dueTestId}
                                    />
                                  </span>
                                  <span className="text-right">
                                    <Amount
                                      value={grandchild.planned}
                                      testId={grandchild.plannedTestId}
                                    />
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

export function WorksheetGrandTotal({ grandTotals }: WorksheetGrandTotalProps) {
  return (
    <div
      className="grid gap-4 lg:grid-cols-2"
      data-testid="worksheet-grand-total"
    >
      <OwedCard grandTotals={grandTotals} />
      <MonthCard grandTotals={grandTotals} />
    </div>
  )
}
