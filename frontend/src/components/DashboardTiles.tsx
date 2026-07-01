import { useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"

import { BudgetCurrentVsAverageChart } from "@/components/BudgetCurrentVsAverageChart"
import { BudgetSpendPieChart } from "@/components/BudgetSpendPieChart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { buildBarChartData, stackTotalsAcrossMonths } from "@/lib/barChart"
import {
  buildCategorizeQueuePath,
  buildSpendingBarPath,
  isUncategorizedDisplayName,
} from "@/lib/manageNav"
import {
  readMomRollingAverageMethod,
  type RollingWindowMonths,
} from "@/lib/momComparePrefs"
import {
  aggregateOtherAmounts,
  aggregateOtherBaselines,
  currentCalendarMonth,
  currentVsRollingBaseline,
  rankStacksByAmount,
} from "@/lib/momVariance"
import {
  formatCurrency,
  isSpendingWithdrawal,
  spendingWithdrawalTotal,
  topCategoryBySpend,
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

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

function KpiSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-32" />
      </CardContent>
    </Card>
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

  const handleBudgetSelect = useCallback(
    (name: string) => {
      if (isUncategorizedDisplayName(name)) {
        navigate(buildCategorizeQueuePath(rangeStart, rangeEnd))
        return
      }
      navigate(buildSpendingBarPath(rangeStart, rangeEnd, name))
    },
    [navigate, rangeStart, rangeEnd],
  )

  const spendingRows = useMemo(
    () => rangeRows.filter(isSpendingWithdrawal),
    [rangeRows],
  )
  const averageSpendingRows = useMemo(
    () => averageRows.filter(isSpendingWithdrawal),
    [averageRows],
  )

  const currentMonth = useMemo(() => currentCalendarMonth(), [])
  const rollingMethod = useMemo(
    () => readMomRollingAverageMethod("spending"),
    [],
  )

  const pieSlices = useMemo(() => {
    if (spendingRows.length === 0) return []
    const chartData = buildBarChartData(spendingRows, ["month", "budget"], {
      start: rangeStart,
      end: rangeEnd,
    })
    const totals = stackTotalsAcrossMonths(chartData)
    const { names } = rankStacksByAmount(totals, BUDGET_PIE_TOP_N)
    const aggregated = aggregateOtherAmounts(totals, names)
    return names
      .filter((name) => aggregated.has(name))
      .map((name) => ({ name, value: aggregated.get(name) ?? 0 }))
      .filter((slice) => slice.value > 0)
  }, [spendingRows, rangeStart, rangeEnd])

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

  const total = spendingWithdrawalTotal(spendingRows)
  const top = topCategoryBySpend(spendingRows)

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {isRangeLoading ? (
        <KpiSkeleton />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total spending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[32px] font-bold leading-tight tracking-tight">
              {formatCurrency(total)}
            </p>
          </CardContent>
        </Card>
      )}

      {isRangeLoading ? (
        <KpiSkeleton />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Top category
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-[32px] font-bold leading-tight tracking-tight">
              {top.name}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatCurrency(top.amount)} · {formatPercent(top.percentOfTotal)}{" "}
              of total
            </p>
          </CardContent>
        </Card>
      )}

      <BudgetSpendPieChart
        slices={pieSlices}
        loading={isRangeLoading}
        emptyMessage="No spending in this date range"
        chartTitle="Spending by budget"
        onSliceSelect={handleBudgetSelect}
      />

      <BudgetCurrentVsAverageChart
        sortedNames={barChartState.sortedNames}
        values={barChartState.values}
        loading={isAverageLoading}
        emptyMessage="Not enough history for a rolling average comparison"
        chartTitle="Current month vs 12-month average"
        onSelect={handleBudgetSelect}
      />
    </div>
  )
}
