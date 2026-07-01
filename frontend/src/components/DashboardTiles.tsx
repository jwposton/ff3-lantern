import { useCallback, useMemo, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"

import { BudgetCurrentVsAverageChart } from "@/components/BudgetCurrentVsAverageChart"
import { BudgetSpendPieChart } from "@/components/BudgetSpendPieChart"
import { CashFlowKpiCard, MonthlyCashFlowKpiCard } from "@/components/MonthlyCashFlowKpiCard"
import { Button } from "@/components/ui/button"
import { buildBarChartData } from "@/lib/barChart"
import {
  budgetVsAverageTileTitle,
  cashFlowByBudgetTileTitle,
  formatCalendarMonthLabel,
  formatDashboardDateRange,
  monthlyCashFlowTileTitle,
  spendingByBudgetTileTitle,
} from "@/lib/dashboardTileLabels"
import { buildBudgetPieSlices, filterRowsInCalendarMonth } from "@/lib/dashboardKpis"
import {
  buildCashFlowBarPath,
  buildCategorizeQueuePath,
  buildSpendingBarPath,
  isUncategorizedDisplayName,
} from "@/lib/manageNav"
import {
  readMomRollingAverageMethod,
  type RollingWindowMonths,
} from "@/lib/momComparePrefs"
import {
  aggregateOtherBaselines,
  currentCalendarMonth,
  currentVsRollingBaseline,
  lastDayOfMonth,
  rankStacksByAmount,
} from "@/lib/momVariance"
import {
  isCashFlowOutflow,
  isSpendingExpense,
  isSpendingWithdrawal,
  monthCashFlowKpi,
} from "@/lib/spending"
import type { OmniRow } from "@/types/NormalizedTransaction"

const BUDGET_PIE_TOP_N = 15
const BUDGET_BAR_TOP_N = 15
const ROLLING_WINDOW_MONTHS = 12 as RollingWindowMonths

type DashboardTilesProps = {
  rangeRows: OmniRow[]
  rangeStart: string
  rangeEnd: string
  averageRows: OmniRow[]
  averageStart: string
  averageEnd: string
  isRangeLoading: boolean
  isAverageLoading: boolean
  isError: boolean
  onRetry: () => void
}

function DashboardSection({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </section>
  )
}

export function DashboardTiles({
  rangeRows,
  rangeStart,
  rangeEnd,
  averageRows,
  averageStart,
  averageEnd,
  isRangeLoading,
  isAverageLoading,
  isError,
  onRetry,
}: DashboardTilesProps) {
  const navigate = useNavigate()

  const currentMonth = useMemo(() => currentCalendarMonth(), [])
  const currentMonthStart = `${currentMonth}-01`
  const currentMonthEnd = useMemo(
    () => lastDayOfMonth(currentMonth),
    [currentMonth],
  )
  const rangeLabel = useMemo(
    () => formatDashboardDateRange(rangeStart, rangeEnd),
    [rangeStart, rangeEnd],
  )
  const currentMonthLabel = useMemo(
    () => formatCalendarMonthLabel(currentMonth),
    [currentMonth],
  )

  const makeBudgetDrillHandler = useCallback(
    (start: string, end: string) => (name: string) => {
      if (isUncategorizedDisplayName(name)) {
        navigate(buildCategorizeQueuePath(start, end))
        return
      }
      navigate(buildSpendingBarPath(start, end, name))
    },
    [navigate],
  )

  const makeCashFlowDrillHandler = useCallback(
    (start: string, end: string) => (name: string) => {
      if (isUncategorizedDisplayName(name)) {
        navigate(buildCategorizeQueuePath(start, end))
        return
      }
      navigate(buildCashFlowBarPath(start, end, name))
    },
    [navigate],
  )

  const averageSpendingRows = useMemo(
    () => averageRows.filter(isSpendingWithdrawal),
    [averageRows],
  )
  const currentMonthRows = useMemo(
    () => filterRowsInCalendarMonth(averageRows, currentMonth),
    [averageRows, currentMonth],
  )
  const monthCashFlow = useMemo(
    () => monthCashFlowKpi(currentMonthRows),
    [currentMonthRows],
  )
  const periodCashFlow = useMemo(
    () => monthCashFlowKpi(rangeRows),
    [rangeRows],
  )
  const rollingMethod = useMemo(
    () => readMomRollingAverageMethod("spending"),
    [],
  )

  const currentMonthSpendingPieSlices = useMemo(
    () =>
      buildBudgetPieSlices(averageRows, currentMonthStart, currentMonthEnd, {
        rowFilter: isSpendingExpense,
        topN: BUDGET_PIE_TOP_N,
      }),
    [averageRows, currentMonthStart, currentMonthEnd],
  )

  const periodSpendingPieSlices = useMemo(
    () =>
      buildBudgetPieSlices(rangeRows, rangeStart, rangeEnd, {
        rowFilter: isSpendingExpense,
        topN: BUDGET_PIE_TOP_N,
      }),
    [rangeRows, rangeStart, rangeEnd],
  )

  const periodCashFlowPieSlices = useMemo(
    () =>
      buildBudgetPieSlices(rangeRows, rangeStart, rangeEnd, {
        rowFilter: isCashFlowOutflow,
        useCashFlowLabels: true,
        topN: BUDGET_PIE_TOP_N,
      }),
    [rangeRows, rangeStart, rangeEnd],
  )

  const barChartState = useMemo(() => {
    const chartData = buildBarChartData(
      averageSpendingRows,
      ["month", "budget"],
      { start: averageStart, end: averageEnd },
    )
    const pairs = currentVsRollingBaseline(
      chartData,
      currentMonth,
      ROLLING_WINDOW_MONTHS,
      rollingMethod,
    )
    if (pairs == null) {
      return { sortedNames: [] as string[], values: new Map() }
    }

    const currentTotals = new Map<string, number>()
    for (const [name, { current }] of pairs) {
      currentTotals.set(name, current)
    }
    const { names } = rankStacksByAmount(currentTotals, BUDGET_BAR_TOP_N)
    const aggregated = aggregateOtherBaselines(pairs, names)
    const sortedNames = names.filter((name) => aggregated.has(name))
    return { sortedNames, values: aggregated }
  }, [
    averageSpendingRows,
    averageStart,
    averageEnd,
    currentMonth,
    rollingMethod,
  ])

  if (isError) {
    return (
      <div
        className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
        role="alert"
      >
        <h2 className="text-sm font-semibold text-destructive">
          Unable to load transactions
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Check that the backend is running and Firefly credentials are
          configured.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <DashboardSection title="This month" subtitle={currentMonthLabel}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <MonthlyCashFlowKpiCard
            currentMonth={currentMonth}
            kpi={monthCashFlow}
            loading={isAverageLoading}
          />

          <BudgetSpendPieChart
            slices={currentMonthSpendingPieSlices}
            loading={isAverageLoading}
            emptyMessage="No spending this month"
            chartTitle={spendingByBudgetTileTitle()}
            chartSubtitle={currentMonthLabel}
            chartTestId="spending-pie-current-month"
            onSliceSelect={makeBudgetDrillHandler(
              currentMonthStart,
              currentMonthEnd,
            )}
          />

          <BudgetCurrentVsAverageChart
            sortedNames={barChartState.sortedNames}
            values={barChartState.values}
            loading={isAverageLoading}
            emptyMessage="Not enough history for a rolling average comparison"
            chartTitle={budgetVsAverageTileTitle()}
            chartSubtitle={currentMonthLabel}
            onSelect={makeBudgetDrillHandler(currentMonthStart, currentMonthEnd)}
          />
        </div>
      </DashboardSection>

      <DashboardSection title="Selected period" subtitle={rangeLabel}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <CashFlowKpiCard
            title={monthlyCashFlowTileTitle()}
            subtitle={rangeLabel}
            kpi={periodCashFlow}
            loading={isRangeLoading}
          />

          <BudgetSpendPieChart
            slices={periodSpendingPieSlices}
            loading={isRangeLoading}
            emptyMessage="No spending in this date range"
            chartTitle={spendingByBudgetTileTitle()}
            chartSubtitle={rangeLabel}
            chartTestId="spending-pie-selected-period"
            onSliceSelect={makeBudgetDrillHandler(rangeStart, rangeEnd)}
          />

          <BudgetSpendPieChart
            slices={periodCashFlowPieSlices}
            loading={isRangeLoading}
            emptyMessage="No cash outflow in this date range"
            chartTitle={cashFlowByBudgetTileTitle()}
            chartSubtitle={rangeLabel}
            chartTestId="cash-flow-pie-selected-period"
            onSliceSelect={makeCashFlowDrillHandler(rangeStart, rangeEnd)}
          />
        </div>
      </DashboardSection>
    </div>
  )
}
