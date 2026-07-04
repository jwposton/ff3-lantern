import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { MomCompareChart } from "@/components/MomCompareChart"
import { MomVarianceDataTable } from "@/components/MomVarianceDataTable"
import { MomTrendChart } from "@/components/MomTrendChart"
import { ReportPageHeader } from "@/components/ReportPageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  buildTrendChartSeries,
  compareDelta,
  compareToRollingAverage,
  currentCalendarMonth,
  defaultMonthPair,
  describeVarianceFetchRange,
  monthPairFromRange,
  rankStacksByAbsDelta,
  rankTrendChartStacks,
  recentSelectableMonths,
  rollingMonthsBefore,
  varianceFetchRange,
} from "@/lib/momVariance"
import {
  buildCategorizeQueuePath,
  isUncategorizedDisplayName,
} from "@/lib/manageNav"
import { readMomTopN, writeMomTopN, type MomTopNFamily } from "@/lib/momTopN"
import {
  buildCompareAmountTableData,
  buildTrendDeltaTableData,
} from "@/lib/momVarianceTable"
import { TOP_N_MAX, TOP_N_MIN } from "@/lib/topNConstants"
import type { OmniRow } from "@/types/NormalizedTransaction"

const OTHER_LABEL = "Other"
const DRILLDOWN_EMPTY_MESSAGE =
  "No category breakdown for this budget in this date range"
const CATEGORIES_TOP_N_LABEL = "Categories shown:"
const COMPARE_TABLE_TITLE = "Monthly amounts"
const TREND_TABLE_TITLE = "Month-over-month change"
const CATEGORY_ROW_LABEL = "Category"
const VARIANCE_SCOPE_NOTE =
  "This report uses its own date range—the global date filter does not apply here."

function initialMonthPair(): { monthA: string; monthB: string } {
  return defaultMonthPair(recentSelectableMonths())
}

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
  rangeMonthsLabel?: string
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
  rangeMonthsLabel = "Range",
  currentMonthLabel = "Current month",
  averageWindowLabel = "Avg window",
}: MomVarianceReportPageProps) {
  const navigate = useNavigate()
  const selectableMonths = useMemo(() => recentSelectableMonths(), [])

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
  const [monthA, setMonthA] = useState(() => initialMonthPair().monthA)
  const [monthB, setMonthB] = useState(() => initialMonthPair().monthB)
  const [trendToMonth, setTrendToMonth] = useState(() => currentCalendarMonth())
  const [currentMonth, setCurrentMonth] = useState(() => currentCalendarMonth())
  const [selectedBudget, setSelectedBudget] = useState<string | null>(null)

  const trendFromMonth = useMemo(
    () => monthPairFromRange(trendToMonth, rollingWindow).monthA,
    [trendToMonth, rollingWindow],
  )

  const varianceRange = useMemo(
    () =>
      varianceFetchRange(
        compareMode,
        activeTab,
        {
          currentMonth,
          rollingWindow,
          monthA,
          monthB,
          trendToMonth,
        },
      ),
    [
      compareMode,
      activeTab,
      currentMonth,
      rollingWindow,
      monthA,
      monthB,
      trendToMonth,
    ],
  )

  const [varianceStart, varianceEnd] = varianceRange ?? ["", ""]

  const varianceRangeLabel =
    varianceRange != null
      ? describeVarianceFetchRange(
          compareMode,
          activeTab,
          varianceRange,
          {
            currentMonth,
            rollingWindow,
            monthA,
            monthB,
            trendToMonth,
          },
        )
      : null

  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(varianceStart, varianceEnd, {
      enabled: varianceRange != null,
    })

  const handleBudgetSelect = useCallback(
    (name: string) => {
      if (isUncategorizedDisplayName(name)) {
        navigate(buildCategorizeQueuePath(varianceStart, varianceEnd))
        return
      }
      setSelectedBudget(name)
    },
    [navigate, varianceStart, varianceEnd],
  )

  const allRows = isSuccess ? (data?.data ?? []) : []
  const sliceRows = useMemo(() => allRows.filter(filter), [allRows, filter])

  const budgetChartData = useMemo(
    () =>
      buildBarChartData(sliceRows, ["month", "budget"], {
        start: varianceStart,
        end: varianceEnd,
        useCashFlowLabels,
      }),
    [sliceRows, varianceStart, varianceEnd, useCashFlowLabels],
  )

  const months = budgetChartData.months
  const compareMonthsSelectable =
    monthA !== "" &&
    monthB !== "" &&
    monthA !== monthB &&
    months.length >= 2
  const monthsSelectable =
    compareMode === "month-pair" && activeTab === "compare"
      ? compareMonthsSelectable
      : months.length >= 2
  const averageMonthsSelectable =
    compareMode === "vs-average" &&
    currentMonth !== "" &&
    rollingMonthsBefore(currentMonth, rollingWindow).some((month) =>
      months.includes(month),
    )

  useEffect(() => {
    setSelectedBudget(null)
  }, [compareMode])

  const categoryChartData = useMemo(() => {
    if (selectedBudget == null) return null

    return buildBarChartData(sliceRows, ["month", "category"], {
      start: varianceStart,
      end: varianceEnd,
      filter: { budget: selectedBudget },
      useCashFlowLabels,
    })
  }, [
    selectedBudget,
    sliceRows,
    varianceStart,
    varianceEnd,
    useCashFlowLabels,
  ])

  const trendOptions = useMemo(
    () => ({
      rollingWindow,
      rollingAverageMethod,
    }),
    [rollingWindow, rollingAverageMethod],
  )

  const trendChartData = useMemo(() => {
    const { deltaMonths, series: allSeries } = buildTrendChartSeries(
      budgetChartData,
      compareMode,
      trendOptions,
    )
    const { names: topNames } = rankTrendChartStacks(
      budgetChartData,
      compareMode,
      trendOptions,
      topN,
    )
    const series = filterTrendSeriesByTopN(allSeries, topNames)
    return { deltaMonths, series }
  }, [budgetChartData, compareMode, trendOptions, topN])

  const trendDisplayMessage =
    compareMode === "vs-average" && trendChartData.deltaMonths.length === 0
      ? compareAverageEmptyMessage
      : emptyMessage

  const compareChartData = useMemo(
    () =>
      buildCompareChartData(
        budgetChartData,
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
      budgetChartData,
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
    const { deltaMonths, series: allSeries } = buildTrendChartSeries(
      categoryChartData,
      compareMode,
      trendOptions,
    )
    const { names: topNames } = rankTrendChartStacks(
      categoryChartData,
      compareMode,
      trendOptions,
      topN,
    )
    const series = filterTrendSeriesByTopN(allSeries, topNames)
    return { deltaMonths, series }
  }, [categoryChartData, compareMode, trendOptions, topN])

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

  const compareTableOptions = useMemo(
    () => ({
      monthA,
      monthB,
      currentMonth,
      rollingWindow,
      rollingAverageMethod,
    }),
    [monthA, monthB, currentMonth, rollingWindow, rollingAverageMethod],
  )

  const compareBudgetTableData = useMemo(() => {
    if (activeTab !== "compare" || selectedBudget != null) return null
    if (compareChartData.sortedNames.length === 0) return null
    return buildCompareAmountTableData(
      budgetChartData,
      compareChartData.sortedNames,
      compareMode,
      compareTableOptions,
    )
  }, [
    activeTab,
    selectedBudget,
    compareChartData.sortedNames,
    budgetChartData,
    compareMode,
    compareTableOptions,
  ])

  const compareCategoryTableData = useMemo(() => {
    if (selectedBudget == null || activeTab !== "compare" || !categoryChartData) {
      return null
    }
    if (categoryCompareChartData.sortedNames.length === 0) return null
    return buildCompareAmountTableData(
      categoryChartData,
      categoryCompareChartData.sortedNames,
      compareMode,
      { ...compareTableOptions, rowLabel: CATEGORY_ROW_LABEL },
    )
  }, [
    selectedBudget,
    activeTab,
    categoryChartData,
    categoryCompareChartData.sortedNames,
    compareMode,
    compareTableOptions,
  ])

  const trendBudgetTableData = useMemo(() => {
    if (activeTab !== "trend" || selectedBudget != null) return null
    return buildTrendDeltaTableData(
      trendChartData.deltaMonths,
      trendChartData.series,
    )
  }, [activeTab, selectedBudget, trendChartData])

  const trendCategoryTableData = useMemo(() => {
    if (selectedBudget == null || activeTab !== "trend") return null
    return buildTrendDeltaTableData(
      categoryTrendChartData.deltaMonths,
      categoryTrendChartData.series,
      CATEGORY_ROW_LABEL,
    )
  }, [selectedBudget, activeTab, categoryTrendChartData])

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

  const compareLoading = isPending

  const hasFetchError = isError

  const controlsDisabled = compareLoading || hasFetchError

  const varianceControls = (
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

      <div
        className="inline-flex rounded-md border shadow-xs"
        role="group"
        aria-label="Compare mode"
      >
        <Button
          type="button"
          variant={compareMode === "vs-average" ? "default" : "outline"}
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
          variant={compareMode === "month-pair" ? "default" : "outline"}
          size="sm"
          className="rounded-l-none border-0 border-l"
          disabled={controlsDisabled}
          onClick={() => {
            setCompareMode("month-pair")
            writeMomCompareMode(momTopNFamily, "month-pair")
            const pair = defaultMonthPair(selectableMonths)
            setMonthA(pair.monthA)
            setMonthB(pair.monthB)
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
              disabled={controlsDisabled || selectableMonths.length === 0}
              onChange={(e) => setCurrentMonth(e.target.value)}
            >
              {selectableMonths.map((month) => (
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
                const next = Number(e.target.value) as RollingWindowMonths
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
              variant={rollingAverageMethod === "mean" ? "default" : "outline"}
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
                rollingAverageMethod === "median" ? "default" : "outline"
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
      ) : activeTab === "compare" ? (
        <>
          <label className="flex items-center gap-2 font-medium">
            {monthALabel}
            <select
              className="min-w-[140px] rounded-md border border-input bg-background px-2 py-1"
              value={monthA}
              disabled={controlsDisabled || selectableMonths.length < 2}
              onChange={(e) => setMonthA(e.target.value)}
            >
              {selectableMonths.map((month) => (
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
              disabled={controlsDisabled || selectableMonths.length < 2}
              onChange={(e) => setMonthB(e.target.value)}
            >
              {selectableMonths.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <label className="flex items-center gap-2 font-medium">
            To month
            <select
              className="min-w-[140px] rounded-md border border-input bg-background px-2 py-1"
              value={trendToMonth}
              disabled={controlsDisabled || selectableMonths.length === 0}
              onChange={(e) => setTrendToMonth(e.target.value)}
            >
              {selectableMonths.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 font-medium">
            {rangeMonthsLabel}
            <select
              className="min-w-[72px] rounded-md border border-input bg-background px-2 py-1"
              value={rollingWindow}
              disabled={controlsDisabled}
              onChange={(e) => {
                const next = Number(e.target.value) as RollingWindowMonths
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
          <span className="text-muted-foreground">From {trendFromMonth}</span>
        </>
      )}

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
        <span className="w-9 text-right font-mono tabular-nums">{topN}</span>
      </label>
    </div>
  )

  return (
    <div className="-m-6 flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="shrink-0 space-y-3 border-b bg-background px-6 pb-3 pt-6"
        data-testid="variance-toolbar"
      >
        <ReportPageHeader title={pageTitle} />
        <p className="text-muted-foreground text-xs">
          {VARIANCE_SCOPE_NOTE}
          {varianceRangeLabel ? ` ${varianceRangeLabel}.` : ""}
        </p>
        {varianceControls}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <div className="space-y-6 pt-6">
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
                }}
              >
                Retry
              </Button>
            </div>
          ) : (
            <>
              {activeTab === "trend" ? (
                <>
                  <MomTrendChart
                    deltaMonths={trendChartData.deltaMonths}
                    series={trendChartData.series}
                    loading={isPending}
                    emptyMessage={trendDisplayMessage}
                    chartTitle={trendChartTitle}
                    interactionHint={interactionHintTrend}
                    yAxisName={yAxisNameTrend}
                    onSelect={handleBudgetSelect}
                  />
                  {isPending || trendBudgetTableData != null ? (
                    <MomVarianceDataTable
                      tableData={trendBudgetTableData}
                      loading={isPending}
                      emptyMessage={trendDisplayMessage}
                      title={TREND_TABLE_TITLE}
                      onRowSelect={handleBudgetSelect}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <MomCompareChart
                    sortedNames={compareChartData.sortedNames}
                    deltas={compareChartData.deltas}
                    loading={compareLoading}
                    emptyMessage={compareDisplayMessage}
                    chartTitle={compareTitle}
                    interactionHint={interactionHintCompare}
                    yAxisName={yAxisNameCompare}
                    onSelect={handleBudgetSelect}
                  />
                  {compareLoading || compareBudgetTableData != null ? (
                    <MomVarianceDataTable
                      tableData={compareBudgetTableData}
                      loading={compareLoading}
                      emptyMessage={compareDisplayMessage}
                      title={COMPARE_TABLE_TITLE}
                      onRowSelect={handleBudgetSelect}
                    />
                  ) : null}
                </>
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
                  <CardContent className="space-y-6">
                    {activeTab === "trend" ? (
                      <>
                        <MomTrendChart
                          embedded
                          deltaMonths={categoryTrendChartData.deltaMonths}
                          series={categoryTrendChartData.series}
                          loading={false}
                          emptyMessage={DRILLDOWN_EMPTY_MESSAGE}
                          chartTitle=""
                          yAxisName={yAxisNameTrend}
                        />
                        {trendCategoryTableData != null ? (
                          <MomVarianceDataTable
                            embedded
                            tableData={trendCategoryTableData}
                            emptyMessage={DRILLDOWN_EMPTY_MESSAGE}
                            title={TREND_TABLE_TITLE}
                          />
                        ) : null}
                      </>
                    ) : (
                      <>
                        <MomCompareChart
                          embedded
                          sortedNames={categoryCompareChartData.sortedNames}
                          deltas={categoryCompareChartData.deltas}
                          loading={false}
                          emptyMessage={DRILLDOWN_EMPTY_MESSAGE}
                          chartTitle=""
                          yAxisName={yAxisNameCompare}
                        />
                        {compareCategoryTableData != null ? (
                          <MomVarianceDataTable
                            embedded
                            tableData={compareCategoryTableData}
                            emptyMessage={DRILLDOWN_EMPTY_MESSAGE}
                            title={COMPARE_TABLE_TITLE}
                          />
                        ) : null}
                      </>
                    )}
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
