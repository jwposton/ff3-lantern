import { useEffect, useMemo, useState } from "react"

import { MomCompareChart } from "@/components/MomCompareChart"
import { MomTrendChart } from "@/components/MomTrendChart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import { buildBarChartData } from "@/lib/barChart"
import {
  type MomCompareMode,
  readMomCompareMode,
  readMomRollingAverageMethod,
  readMomRollingWindow,
  ROLLING_WINDOW_OPTIONS,
  type RollingAverageMethod,
  type RollingWindowMonths,
  writeMomCompareMode,
  writeMomRollingAverageMethod,
  writeMomRollingWindow,
} from "@/lib/momComparePrefs"
import {
  aggregateOtherDeltas,
  buildTrendDeltaSeries,
  compareDelta,
  compareToRollingAverage,
  currentCalendarMonth,
  defaultMonthPair,
  rankStacksByAbsDelta,
  rankTrendStacksByActivity,
  rollingAverageFetchRange,
  rollingMonthsBefore,
  sliceTrendWindowMonths,
} from "@/lib/momVariance"
import { readMomTopN, writeMomTopN, type MomTopNFamily } from "@/lib/momTopN"
import { TOP_N_MAX, TOP_N_MIN } from "@/lib/topNConstants"
import type { OmniRow } from "@/types/NormalizedTransaction"

const OTHER_LABEL = "Other"
const DRILLDOWN_EMPTY_MESSAGE =
  "No category breakdown for this budget in this date range"
const CATEGORIES_TOP_N_LABEL = "Categories shown:"

export type MomVarianceReportPageProps = {
  filter: (row: OmniRow) => boolean
  pageTitle: string
  emptyMessage: string
  compareEmptyMessage: string
  compareAverageEmptyMessage?: string
  useCashFlowLabels?: boolean
  momTopNFamily: MomTopNFamily
  trendChartTitle: string
  compareChartTitle: string
  compareAverageChartTitle?: string
  yAxisNameTrend: string
  yAxisNameCompare: string
  interactionHintTrend: string
  interactionHintCompare: string
  tabTrendLabel: string
  tabCompareLabel: string
  topNLabel: string
  monthALabel?: string
  monthBLabel?: string
  currentMonthLabel?: string
  averageWindowLabel?: string
}

type ActiveTab = "trend" | "compare"

function filterTrendSeriesByTopN(
  allSeries: { name: string; data: number[] }[],
  topNames: string[],
): { name: string; data: number[] }[] {
  const topSet = new Set(topNames.filter((name) => name !== OTHER_LABEL))
  const includesOther = topNames.includes(OTHER_LABEL)

  const filtered = allSeries.filter((s) => topSet.has(s.name))

  if (includesOther) {
    const pointCount = allSeries[0]?.data.length ?? 0
    const otherData = Array.from({ length: pointCount }, (_, idx) =>
      allSeries
        .filter((s) => !topSet.has(s.name))
        .reduce((sum, s) => sum + (s.data[idx] ?? 0), 0),
    )
    filtered.push({ name: OTHER_LABEL, data: otherData })
  }

  return filtered
}

function buildCompareChartData(
  chartData: ReturnType<typeof buildBarChartData>,
  compareMode: MomCompareMode,
  topN: number,
  monthA: string,
  monthB: string,
  currentMonth: string,
  rollingWindow: RollingWindowMonths,
  rollingAverageMethod: RollingAverageMethod,
  monthsSelectable: boolean,
): { sortedNames: string[]; deltas: Map<string, number> } {
  if (compareMode === "vs-average") {
    if (!currentMonth) {
      return { sortedNames: [], deltas: new Map() }
    }
    const baselineMonths = rollingMonthsBefore(currentMonth, rollingWindow)
    const hasBaseline = baselineMonths.some((month) =>
      chartData.months.includes(month),
    )
    if (!hasBaseline) {
      return { sortedNames: [], deltas: new Map() }
    }

    const rawDeltas = compareToRollingAverage(
      chartData,
      currentMonth,
      rollingWindow,
      rollingAverageMethod,
    )
    const { names: topNames } = rankStacksByAbsDelta(rawDeltas, topN)
    const aggregated = aggregateOtherDeltas(rawDeltas, topNames)
    const sortedNames = topNames.filter((name) => aggregated.has(name))
    return { sortedNames, deltas: aggregated }
  }

  if (!monthsSelectable || !monthA || !monthB) {
    return { sortedNames: [], deltas: new Map() }
  }

  const rawDeltas = compareDelta(chartData, monthA, monthB)
  const { names: topNames } = rankStacksByAbsDelta(rawDeltas, topN)
  const aggregated = aggregateOtherDeltas(rawDeltas, topNames)
  const sortedNames = topNames.filter((name) => aggregated.has(name))
  return { sortedNames, deltas: aggregated }
}

export function MomVarianceReportPage({
  filter,
  pageTitle,
  emptyMessage,
  compareEmptyMessage,
  compareAverageEmptyMessage = "Not enough history for a rolling average comparison",
  useCashFlowLabels = false,
  momTopNFamily,
  trendChartTitle,
  compareChartTitle,
  compareAverageChartTitle,
  yAxisNameTrend,
  yAxisNameCompare,
  interactionHintTrend,
  interactionHintCompare,
  tabTrendLabel,
  tabCompareLabel,
  topNLabel,
  monthALabel = "Month A",
  monthBLabel = "Month B",
  currentMonthLabel = "Current month",
  averageWindowLabel = "Avg window",
}: MomVarianceReportPageProps) {
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(committedStart, committedEnd)

  const [activeTab, setActiveTab] = useState<ActiveTab>("compare")
  const [compareMode, setCompareMode] = useState<MomCompareMode>(() =>
    readMomCompareMode(momTopNFamily),
  )
  const [rollingWindow, setRollingWindow] = useState<RollingWindowMonths>(() =>
    readMomRollingWindow(momTopNFamily),
  )
  const [rollingAverageMethod, setRollingAverageMethod] =
    useState<RollingAverageMethod>(() =>
      readMomRollingAverageMethod(momTopNFamily),
    )
  const [topN, setTopN] = useState(() => readMomTopN(momTopNFamily))
  const [monthA, setMonthA] = useState("")
  const [monthB, setMonthB] = useState("")
  const [currentMonth, setCurrentMonth] = useState(() => currentCalendarMonth())
  const [selectedBudget, setSelectedBudget] = useState<string | null>(null)

  const [averageStart, averageEnd] = useMemo(
    () => rollingAverageFetchRange(currentMonth, rollingWindow),
    [currentMonth, rollingWindow],
  )

  const {
    isPending: isAveragePending,
    isError: isAverageError,
    isSuccess: isAverageSuccess,
    data: averageData,
    refetch: refetchAverage,
  } = useNormalizedTransactions(averageStart, averageEnd, {
    enabled: compareMode === "vs-average",
  })

  const allRows = isSuccess ? (data?.data ?? []) : []
  const sliceRows = useMemo(() => allRows.filter(filter), [allRows, filter])

  const averageRows = useMemo(() => {
    if (compareMode !== "vs-average" || !isAverageSuccess) return []
    return (averageData?.data ?? []).filter(filter)
  }, [compareMode, isAverageSuccess, averageData, filter])

  const budgetChartData = useMemo(
    () =>
      buildBarChartData(sliceRows, ["month", "budget"], {
        start: committedStart,
        end: committedEnd,
        useCashFlowLabels,
      }),
    [sliceRows, committedStart, committedEnd, useCashFlowLabels],
  )

  const compareBudgetChartData = useMemo(() => {
    if (compareMode === "vs-average") {
      return buildBarChartData(averageRows, ["month", "budget"], {
        start: averageStart,
        end: averageEnd,
        useCashFlowLabels,
      })
    }
    return budgetChartData
  }, [
    compareMode,
    averageRows,
    averageStart,
    averageEnd,
    useCashFlowLabels,
    budgetChartData,
  ])

  const months = budgetChartData.months
  const compareMonths = compareBudgetChartData.months
  const monthsSelectable = months.length >= 2
  const averageMonthsSelectable =
    compareMode === "vs-average" &&
    currentMonth !== "" &&
    rollingMonthsBefore(currentMonth, rollingWindow).some((month) =>
      compareMonths.includes(month),
    )

  useEffect(() => {
    const pair = defaultMonthPair(months)
    setMonthA(pair.monthA)
    setMonthB(pair.monthB)
    setSelectedBudget(null)
  }, [committedStart, committedEnd, months])

  useEffect(() => {
    if (compareMode !== "vs-average") return
    if (compareMonths.length === 0) return
    if (!compareMonths.includes(currentMonth)) {
      setCurrentMonth(compareMonths[compareMonths.length - 1]!)
    }
  }, [compareMode, compareMonths, currentMonth])

  const categoryChartData = useMemo(() => {
    if (selectedBudget == null) return null

    if (compareMode === "vs-average" && activeTab === "compare") {
      return buildBarChartData(averageRows, ["month", "category"], {
        start: averageStart,
        end: averageEnd,
        filter: { budget: selectedBudget },
        useCashFlowLabels,
      })
    }

    return buildBarChartData(sliceRows, ["month", "category"], {
      start: committedStart,
      end: committedEnd,
      filter: { budget: selectedBudget },
      useCashFlowLabels,
    })
  }, [
    selectedBudget,
    compareMode,
    activeTab,
    averageRows,
    averageStart,
    averageEnd,
    sliceRows,
    committedStart,
    committedEnd,
    useCashFlowLabels,
  ])

  const trendChartData = useMemo(() => {
    const windowMonths = sliceTrendWindowMonths(budgetChartData.months)
    const { deltaMonths, series: allSeries } = buildTrendDeltaSeries(
      budgetChartData,
      windowMonths,
    )
    const { names: topNames } = rankTrendStacksByActivity(
      budgetChartData,
      windowMonths,
      topN,
    )
    const series = filterTrendSeriesByTopN(allSeries, topNames)
    return { deltaMonths, series }
  }, [budgetChartData, topN])

  const compareChartData = useMemo(
    () =>
      buildCompareChartData(
        compareBudgetChartData,
        compareMode,
        topN,
        monthA,
        monthB,
        currentMonth,
        rollingWindow,
        rollingAverageMethod,
        monthsSelectable,
      ),
    [
      compareBudgetChartData,
      compareMode,
      topN,
      monthA,
      monthB,
      currentMonth,
      rollingWindow,
      rollingAverageMethod,
      monthsSelectable,
    ],
  )

  const categoryTrendChartData = useMemo(() => {
    if (!categoryChartData) {
      return {
        deltaMonths: [] as string[],
        series: [] as { name: string; data: number[] }[],
      }
    }
    const windowMonths = sliceTrendWindowMonths(categoryChartData.months)
    const { deltaMonths, series: allSeries } = buildTrendDeltaSeries(
      categoryChartData,
      windowMonths,
    )
    const { names: topNames } = rankTrendStacksByActivity(
      categoryChartData,
      windowMonths,
      topN,
    )
    const series = filterTrendSeriesByTopN(allSeries, topNames)
    return { deltaMonths, series }
  }, [categoryChartData, topN])

  const categoryCompareChartData = useMemo(() => {
    if (!categoryChartData) {
      return { sortedNames: [] as string[], deltas: new Map<string, number>() }
    }

    return buildCompareChartData(
      categoryChartData,
      compareMode,
      topN,
      monthA,
      monthB,
      currentMonth,
      rollingWindow,
      rollingAverageMethod,
      monthsSelectable,
    )
  }, [
    categoryChartData,
    compareMode,
    topN,
    monthA,
    monthB,
    currentMonth,
    rollingWindow,
    rollingAverageMethod,
    monthsSelectable,
  ])

  const displayTopNLabel =
    selectedBudget != null ? CATEGORIES_TOP_N_LABEL : topNLabel

  const compareDisplayMessage =
    compareMode === "vs-average"
      ? averageMonthsSelectable
        ? emptyMessage
        : compareAverageEmptyMessage
      : monthsSelectable
        ? emptyMessage
        : compareEmptyMessage

  const compareTitle =
    compareMode === "vs-average" && compareAverageChartTitle
      ? compareAverageChartTitle
      : compareChartTitle

  const compareLoading =
    isPending || (compareMode === "vs-average" && isAveragePending)

  const hasFetchError = isError || (compareMode === "vs-average" && isAverageError)

  const controlsDisabled = compareLoading || hasFetchError

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">{pageTitle}</h1>

      {hasFetchError ? (
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              void refetch()
              if (compareMode === "vs-average") {
                void refetchAverage()
              }
            }}
          >
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div
            className={`flex flex-wrap items-center gap-4 text-sm ${controlsDisabled ? "opacity-50" : ""}`}
          >
            <div
              className="inline-flex rounded-md border shadow-xs"
              role="group"
              aria-label="MoM view mode"
            >
              <Button
                type="button"
                variant={activeTab === "compare" ? "default" : "outline"}
                size="sm"
                className="rounded-r-none border-0"
                disabled={controlsDisabled}
                onClick={() => setActiveTab("compare")}
              >
                {tabCompareLabel}
              </Button>
              <Button
                type="button"
                variant={activeTab === "trend" ? "default" : "outline"}
                size="sm"
                className="rounded-l-none border-0 border-l"
                disabled={controlsDisabled}
                onClick={() => setActiveTab("trend")}
              >
                {tabTrendLabel}
              </Button>
            </div>

            {activeTab === "compare" ? (
              <>
                <div
                  className="inline-flex rounded-md border shadow-xs"
                  role="group"
                  aria-label="Compare mode"
                >
                  <Button
                    type="button"
                    variant={
                      compareMode === "vs-average" ? "default" : "outline"
                    }
                    size="sm"
                    className="rounded-r-none border-0"
                    disabled={controlsDisabled}
                    onClick={() => {
                      setCompareMode("vs-average")
                      writeMomCompareMode(momTopNFamily, "vs-average")
                    }}
                  >
                    vs Average
                  </Button>
                  <Button
                    type="button"
                    variant={
                      compareMode === "month-pair" ? "default" : "outline"
                    }
                    size="sm"
                    className="rounded-l-none border-0 border-l"
                    disabled={controlsDisabled}
                    onClick={() => {
                      setCompareMode("month-pair")
                      writeMomCompareMode(momTopNFamily, "month-pair")
                    }}
                  >
                    vs Month
                  </Button>
                </div>

                {compareMode === "vs-average" ? (
                  <>
                    <label className="flex items-center gap-2 font-medium">
                      {currentMonthLabel}
                      <select
                        className="min-w-[140px] rounded-md border border-input bg-background px-2 py-1"
                        value={currentMonth}
                        disabled={controlsDisabled || compareMonths.length === 0}
                        onChange={(e) => setCurrentMonth(e.target.value)}
                      >
                        {compareMonths.map((month) => (
                          <option key={month} value={month}>
                            {month}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 font-medium">
                      {averageWindowLabel}
                      <select
                        className="min-w-[72px] rounded-md border border-input bg-background px-2 py-1"
                        value={rollingWindow}
                        disabled={controlsDisabled}
                        onChange={(e) => {
                          const next = Number(
                            e.target.value,
                          ) as RollingWindowMonths
                          setRollingWindow(next)
                          writeMomRollingWindow(momTopNFamily, next)
                        }}
                      >
                        {ROLLING_WINDOW_OPTIONS.map((months) => (
                          <option key={months} value={months}>
                            {months} mo
                          </option>
                        ))}
                      </select>
                    </label>
                    <div
                      className="inline-flex rounded-md border shadow-xs"
                      role="group"
                      aria-label="Rolling average method"
                    >
                      <Button
                        type="button"
                        variant={
                          rollingAverageMethod === "mean" ? "default" : "outline"
                        }
                        size="sm"
                        className="rounded-r-none border-0"
                        disabled={controlsDisabled}
                        onClick={() => {
                          setRollingAverageMethod("mean")
                          writeMomRollingAverageMethod(momTopNFamily, "mean")
                        }}
                      >
                        Mean
                      </Button>
                      <Button
                        type="button"
                        variant={
                          rollingAverageMethod === "median"
                            ? "default"
                            : "outline"
                        }
                        size="sm"
                        className="rounded-l-none border-0 border-l"
                        disabled={controlsDisabled}
                        onClick={() => {
                          setRollingAverageMethod("median")
                          writeMomRollingAverageMethod(momTopNFamily, "median")
                        }}
                      >
                        Median
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="flex items-center gap-2 font-medium">
                      {monthALabel}
                      <select
                        className="min-w-[140px] rounded-md border border-input bg-background px-2 py-1"
                        value={monthA}
                        disabled={controlsDisabled || !monthsSelectable}
                        onChange={(e) => setMonthA(e.target.value)}
                      >
                        {months.map((month) => (
                          <option key={month} value={month}>
                            {month}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 font-medium">
                      {monthBLabel}
                      <select
                        className="min-w-[140px] rounded-md border border-input bg-background px-2 py-1"
                        value={monthB}
                        disabled={controlsDisabled || !monthsSelectable}
                        onChange={(e) => setMonthB(e.target.value)}
                      >
                        {months.map((month) => (
                          <option key={month} value={month}>
                            {month}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </>
            ) : null}

            <label className="flex items-center gap-2 font-medium">
              {displayTopNLabel}
              <input
                type="range"
                min={TOP_N_MIN}
                max={TOP_N_MAX}
                value={topN}
                disabled={controlsDisabled}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setTopN(n)
                  writeMomTopN(momTopNFamily, n)
                  setSelectedBudget(null)
                }}
                className="accent-primary"
                style={{ width: 120 }}
              />
              <span className="w-9 text-right font-mono tabular-nums">
                {topN}
              </span>
            </label>
          </div>

          {activeTab === "trend" ? (
            <MomTrendChart
              deltaMonths={trendChartData.deltaMonths}
              series={trendChartData.series}
              loading={isPending}
              emptyMessage={emptyMessage}
              chartTitle={trendChartTitle}
              interactionHint={interactionHintTrend}
              yAxisName={yAxisNameTrend}
              onSelect={setSelectedBudget}
            />
          ) : (
            <MomCompareChart
              sortedNames={compareChartData.sortedNames}
              deltas={compareChartData.deltas}
              loading={compareLoading}
              emptyMessage={compareDisplayMessage}
              chartTitle={compareTitle}
              interactionHint={interactionHintCompare}
              yAxisName={yAxisNameCompare}
              onSelect={setSelectedBudget}
            />
          )}

          {selectedBudget != null && !compareLoading ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">
                  {selectedBudget} breakdown
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedBudget(null)}
                  aria-label="Clear MoM drilldown"
                >
                  Clear
                </Button>
              </CardHeader>
              <CardContent>
                {activeTab === "trend" ? (
                  <MomTrendChart
                    embedded
                    deltaMonths={categoryTrendChartData.deltaMonths}
                    series={categoryTrendChartData.series}
                    loading={false}
                    emptyMessage={DRILLDOWN_EMPTY_MESSAGE}
                    chartTitle=""
                    yAxisName={yAxisNameTrend}
                  />
                ) : (
                  <MomCompareChart
                    embedded
                    sortedNames={categoryCompareChartData.sortedNames}
                    deltas={categoryCompareChartData.deltas}
                    loading={false}
                    emptyMessage={DRILLDOWN_EMPTY_MESSAGE}
                    chartTitle=""
                    yAxisName={yAxisNameCompare}
                  />
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  )
}
