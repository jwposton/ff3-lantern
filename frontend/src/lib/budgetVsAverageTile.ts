import type {
  BudgetVsAverageDisplayMode,
  BudgetVsAverageRankMode,
} from "@/lib/budgetVsAveragePrefs"
import {
  aggregateOtherBaselines,
  compareToRollingAverage,
  type CurrentVsBaseline,
  rankStacksByAbsDelta,
  rankStacksByAmount,
} from "@/lib/momVariance"
import type { BarChartData } from "@/lib/barChart"
import type { RollingAverageMethod, RollingWindowMonths } from "@/lib/momComparePrefs"

export type BudgetVsAverageTileState = {
  sortedNames: string[]
  values: Map<string, CurrentVsBaseline>
}

export type PercentBarChartDatum =
  | { kind: "ratio"; percent: number }
  | { kind: "no-prior-average"; barPercent: number; current: number }
  | { kind: "empty" }

/** Percent of 12-mo average, or null when baseline is zero (ratio undefined). */
export function percentOfAverage(current: number, baseline: number): number | null {
  if (baseline === 0) return null
  return (current / baseline) * 100
}

/** Bar length for no-prior-average rows: capped at 100% (color distinguishes from ratio bars). */
export function noPriorAverageBarPercent(): number {
  return 100
}

export function buildPercentBarChartData(
  sortedNames: string[],
  values: Map<string, CurrentVsBaseline>,
): PercentBarChartDatum[] {
  return sortedNames.map((name) => {
    const pair = values.get(name)
    if (!pair) return { kind: "empty" }
    if (pair.baseline === 0) {
      if (pair.current <= 0) return { kind: "empty" }
      return {
        kind: "no-prior-average",
        barPercent: noPriorAverageBarPercent(),
        current: pair.current,
      }
    }
    return {
      kind: "ratio",
      percent: (pair.current / pair.baseline) * 100,
    }
  })
}

export function percentOfAverageLabel(current: number, baseline: number): string {
  if (baseline === 0) {
    return current === 0
      ? "No spending and no prior average"
      : "No prior average — new spending this month"
  }
  return `${percentOfAverage(current, baseline)!.toFixed(0)}% of average`
}

export function budgetVsAverageRankSubtitle(
  rankMode: BudgetVsAverageRankMode,
): string {
  return rankMode === "total-spend"
    ? "Top budgets by current or average spend"
    : "Largest changes vs 12-month average"
}

export function budgetVsAverageDisplayHint(
  displayMode: BudgetVsAverageDisplayMode,
): string {
  return displayMode === "dollars"
    ? "Side-by-side current month and 12-month average ($)"
    : "Percent of 12-month average (100% = on track). Amber bars = new spending with no prior average."
}

export function budgetVsAverageTileSubtitle(
  monthLabel: string,
  rankMode: BudgetVsAverageRankMode,
): string {
  return `${monthLabel} · ${budgetVsAverageRankSubtitle(rankMode)}`
}

const OTHER_LABEL = "Other"

/** Dollars-mode row order: longest bar on the row (max of current month and 12-mo avg). */
export function dollarsDisplaySortKey(pair: CurrentVsBaseline): number {
  return Math.max(pair.current, pair.baseline)
}

/** Sort chart rows so Y-axis order matches visible bar magnitude (stable tie-break). */
export function sortBudgetVsAverageDisplayNames(
  names: string[],
  values: Map<string, CurrentVsBaseline>,
  displayMode: BudgetVsAverageDisplayMode,
): string[] {
  const other = names.filter((name) => name === OTHER_LABEL)
  const rest = names.filter((name) => name !== OTHER_LABEL)

  function displaySortKey(name: string): number {
    const pair = values.get(name)
    if (!pair) return -Infinity

    if (displayMode === "percent-of-average") {
      if (pair.baseline === 0) {
        return pair.current > 0 ? pair.current : -Infinity
      }
      return (pair.current / pair.baseline) * 100
    }

    // Dollars view: order by the larger of the two side-by-side bars.
    return dollarsDisplaySortKey(pair)
  }

  function isNewSpendWithoutAverage(name: string): boolean {
    const pair = values.get(name)
    return pair != null && pair.baseline === 0 && pair.current > 0
  }

  rest.sort((a, b) => {
    if (displayMode === "percent-of-average") {
      const aNew = isNewSpendWithoutAverage(a)
      const bNew = isNewSpendWithoutAverage(b)
      if (aNew !== bNew) return aNew ? 1 : -1
    }
    const keyDiff = displaySortKey(b) - displaySortKey(a)
    return keyDiff !== 0 ? keyDiff : a.localeCompare(b)
  })

  return [...rest, ...other]
}

export function buildBudgetVsAverageTileState(
  chartData: BarChartData,
  currentMonth: string,
  windowMonths: RollingWindowMonths,
  rollingMethod: RollingAverageMethod,
  rankMode: BudgetVsAverageRankMode,
  displayMode: BudgetVsAverageDisplayMode,
  topN: number,
  pairs: Map<string, CurrentVsBaseline> | null,
): BudgetVsAverageTileState {
  if (pairs == null) {
    return { sortedNames: [], values: new Map() }
  }

  let names: string[]
  if (rankMode === "change-vs-average") {
    const rawDeltas = compareToRollingAverage(
      chartData,
      currentMonth,
      windowMonths,
      rollingMethod,
    )
    names = rankStacksByAbsDelta(rawDeltas, topN).names
  } else {
    const rankTotals = new Map<string, number>()
    for (const [name, pair] of pairs) {
      rankTotals.set(name, dollarsDisplaySortKey(pair))
    }
    names = rankStacksByAmount(rankTotals, topN).names
  }

  const aggregated = aggregateOtherBaselines(pairs, names)
  const rankedNames = names.filter((name) => aggregated.has(name))
  const sortedNames = sortBudgetVsAverageDisplayNames(
    rankedNames,
    aggregated,
    displayMode,
  )
  return { sortedNames, values: aggregated }
}
