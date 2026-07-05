import type { BarChartData } from "@/lib/barChart"
import type { DateRange } from "@/lib/dateRange"
import type {
  MomCompareMode,
  RollingAverageMethod,
  RollingWindowMonths,
} from "@/lib/momComparePrefs"
import { referenceDate } from "@/lib/appClock"
import { enumerateMonths } from "@/lib/trends"

const OTHER_LABEL = "Other"

export function addMonths(month: string, delta: number): string {
  let y = Number(month.slice(0, 4))
  let m = Number(month.slice(5, 7))
  m += delta
  while (m < 1) {
    m += 12
    y -= 1
  }
  while (m > 12) {
    m -= 12
    y += 1
  }
  return `${y}-${String(m).padStart(2, "0")}`
}

export function currentCalendarMonth(now: Date = referenceDate()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

export function lastDayOfMonth(month: string): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const day = new Date(y, m, 0).getDate()
  return `${month}-${String(day).padStart(2, "0")}`
}

export function rollingMonthsBefore(
  currentMonth: string,
  count: number,
): string[] {
  const months: string[] = []
  for (let i = count; i >= 1; i -= 1) {
    months.push(addMonths(currentMonth, -i))
  }
  return months
}

export function rollingAverageFetchRange(
  currentMonth: string,
  windowMonths: RollingWindowMonths,
  now: Date = new Date(),
): DateRange {
  const baselineStart = addMonths(currentMonth, -windowMonths)
  const start = `${baselineStart}-01`
  const monthEnd = lastDayOfMonth(currentMonth)
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const end = monthEnd <= today ? monthEnd : today
  return [start, end]
}

export const VARIANCE_MONTH_PICKER_LOOKBACK = 24

export function recentSelectableMonths(
  now: Date = new Date(),
  lookbackMonths = VARIANCE_MONTH_PICKER_LOOKBACK,
): string[] {
  const endMonth = currentCalendarMonth(now)
  const startMonth = addMonths(endMonth, -(lookbackMonths - 1))
  return enumerateMonths(`${startMonth}-01`, lastDayOfMonth(endMonth))
}

export function monthPairFetchRange(monthA: string, monthB: string): DateRange | null {
  if (!monthA || !monthB) return null
  const first = monthA <= monthB ? monthA : monthB
  const last = monthA <= monthB ? monthB : monthA
  return [`${first}-01`, lastDayOfMonth(last)]
}

export function monthSpanMonths(monthA: string, monthB: string): string[] {
  const range = monthPairFetchRange(monthA, monthB)
  if (!range) return []
  return enumerateMonths(range[0], range[1])
}

export function monthPairFromRange(
  toMonth: string,
  spanMonths: RollingWindowMonths,
): { monthA: string; monthB: string } {
  return {
    monthA: addMonths(toMonth, -(spanMonths - 1)),
    monthB: toMonth,
  }
}

export function comparePairTableMonths(monthA: string, monthB: string): string[] {
  if (!monthA || !monthB) return []
  return monthA <= monthB ? [monthA, monthB] : [monthB, monthA]
}

export function varianceFetchRange(
  compareMode: MomCompareMode,
  activeTab: "trend" | "compare",
  options: {
    currentMonth: string
    rollingWindow: RollingWindowMonths
    monthA: string
    monthB: string
    trendToMonth: string
  },
  now: Date = new Date(),
): DateRange | null {
  if (compareMode === "vs-average") {
    if (!options.currentMonth) return null
    return rollingAverageFetchRange(
      options.currentMonth,
      options.rollingWindow,
      now,
    )
  }
  if (activeTab === "compare") {
    return monthPairFetchRange(options.monthA, options.monthB)
  }
  if (!options.trendToMonth) return null
  const trendPair = monthPairFromRange(
    options.trendToMonth,
    options.rollingWindow,
  )
  return monthPairFetchRange(trendPair.monthA, trendPair.monthB)
}

export function describeVarianceFetchRange(
  compareMode: MomCompareMode,
  activeTab: "trend" | "compare",
  range: DateRange,
  options: {
    currentMonth: string
    rollingWindow: RollingWindowMonths
    monthA: string
    monthB: string
    trendToMonth: string
  },
): string {
  if (compareMode === "vs-average") {
    return `${options.rollingWindow}-month window ending ${options.currentMonth} (${range[0]} – ${range[1]})`
  }
  if (activeTab === "compare") {
    if (!options.monthA || !options.monthB) {
      return `${range[0]} – ${range[1]}`
    }
    const fromMonth =
      options.monthA <= options.monthB ? options.monthA : options.monthB
    const toMonth =
      options.monthA <= options.monthB ? options.monthB : options.monthA
    return `Month pair ${fromMonth} vs ${toMonth} (${range[0]} – ${range[1]})`
  }
  const trendPair = monthPairFromRange(
    options.trendToMonth,
    options.rollingWindow,
  )
  const spanMonths = monthSpanMonths(trendPair.monthA, trendPair.monthB)
  return `${spanMonths.length}-month trend ${trendPair.monthA} through ${trendPair.monthB} (${range[0]} – ${range[1]})`
}

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[mid]!
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function rollingBaselineAmount(
  chartData: BarChartData,
  stack: string,
  baselineMonths: string[],
  method: RollingAverageMethod,
): number {
  const values = baselineMonths.map(
    (month) => chartData.data[month]?.[stack] ?? 0,
  )
  if (method === "median") {
    return medianOf(values)
  }
  return values.reduce((total, value) => total + value, 0) / values.length
}

export function baselineMonthsInChart(
  chartData: BarChartData,
  currentMonth: string,
  windowMonths: RollingWindowMonths,
): string[] {
  return rollingMonthsBefore(currentMonth, windowMonths).filter((month) =>
    chartData.months.includes(month),
  )
}

export type CurrentVsBaseline = {
  current: number
  baseline: number
}

export function currentVsRollingBaseline(
  chartData: BarChartData,
  currentMonth: string,
  windowMonths: RollingWindowMonths,
  method: RollingAverageMethod = "mean",
): Map<string, CurrentVsBaseline> | null {
  const baselineMonths = baselineMonthsInChart(
    chartData,
    currentMonth,
    windowMonths,
  )
  if (baselineMonths.length === 0) {
    return null
  }

  const result = new Map<string, CurrentVsBaseline>()
  for (const stack of chartData.stacks) {
    result.set(stack, {
      current: chartData.data[currentMonth]?.[stack] ?? 0,
      baseline: rollingBaselineAmount(
        chartData,
        stack,
        baselineMonths,
        method,
      ),
    })
  }
  return result
}

export function compareToRollingAverage(
  chartData: BarChartData,
  currentMonth: string,
  windowMonths: RollingWindowMonths,
  method: RollingAverageMethod = "mean",
): Map<string, number> {
  const pairs = currentVsRollingBaseline(
    chartData,
    currentMonth,
    windowMonths,
    method,
  )
  const deltas = new Map<string, number>()
  if (pairs == null) {
    return deltas
  }

  for (const [stack, { current, baseline }] of pairs) {
    deltas.set(stack, current - baseline)
  }

  return deltas
}

export function compareDelta(
  chartData: BarChartData,
  monthA: string,
  monthB: string,
): Map<string, number> {
  const deltas = new Map<string, number>()
  for (const stack of chartData.stacks) {
    const a = chartData.data[monthA]?.[stack] ?? 0
    const b = chartData.data[monthB]?.[stack] ?? 0
    deltas.set(stack, b - a)
  }
  return deltas
}

export function sliceTrendWindowMonths(
  months: string[],
  maxMonths: number = 0,
): string[] {
  if (maxMonths <= 0 || months.length <= maxMonths) return months
  return months.slice(-maxMonths)
}

export function trendDeltaMonths(windowMonths: string[]): string[] {
  return windowMonths.slice(1)
}

export function defaultMonthPair(months: string[]): {
  monthA: string
  monthB: string
} {
  if (months.length === 0) {
    return { monthA: "", monthB: "" }
  }
  if (months.length === 1) {
    return { monthA: "", monthB: months[0]! }
  }
  return {
    monthA: months[months.length - 2]!,
    monthB: months[months.length - 1]!,
  }
}

export function rankStacksByAbsDelta(
  deltas: Map<string, number>,
  topN: number,
): { names: string[]; includesOther: boolean } {
  const sorted = [...deltas.entries()].sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
  )
  const top = sorted.slice(0, topN).map(([name]) => name)
  const includesOther = sorted.length > topN
  return {
    names: includesOther ? [...top, OTHER_LABEL] : top,
    includesOther,
  }
}

export function rankStacksByAmount(
  totals: Map<string, number>,
  topN: number,
): { names: string[]; includesOther: boolean } {
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, topN).map(([name]) => name)
  const includesOther = sorted.length > topN
  return {
    names: includesOther ? [...top, OTHER_LABEL] : top,
    includesOther,
  }
}

export function aggregateOtherAmounts(
  totals: Map<string, number>,
  topNames: string[],
): Map<string, number> {
  const topSet = new Set(topNames.filter((name) => name !== OTHER_LABEL))
  const result = new Map<string, number>()
  let otherSum = 0
  let hasExcluded = false

  for (const [name, amount] of totals) {
    if (topSet.has(name)) {
      result.set(name, amount)
    } else {
      otherSum += amount
      hasExcluded = true
    }
  }

  if (hasExcluded) {
    result.set(OTHER_LABEL, otherSum)
  }

  return result
}

export function aggregateOtherBaselines(
  pairs: Map<string, CurrentVsBaseline>,
  topNames: string[],
): Map<string, CurrentVsBaseline> {
  const topSet = new Set(topNames.filter((name) => name !== OTHER_LABEL))
  const result = new Map<string, CurrentVsBaseline>()
  let otherCurrent = 0
  let otherBaseline = 0
  let hasExcluded = false

  for (const [name, values] of pairs) {
    if (topSet.has(name)) {
      result.set(name, values)
    } else {
      otherCurrent += values.current
      otherBaseline += values.baseline
      hasExcluded = true
    }
  }

  if (hasExcluded) {
    result.set(OTHER_LABEL, {
      current: otherCurrent,
      baseline: otherBaseline,
    })
  }

  return result
}

export function aggregateOtherDeltas(
  deltas: Map<string, number>,
  topNames: string[],
): Map<string, number> {
  const topSet = new Set(topNames.filter((name) => name !== OTHER_LABEL))
  const result = new Map<string, number>()
  let otherSum = 0
  let hasExcluded = false

  for (const [name, delta] of deltas) {
    if (topSet.has(name)) {
      result.set(name, delta)
    } else {
      otherSum += delta
      hasExcluded = true
    }
  }

  if (hasExcluded) {
    result.set(OTHER_LABEL, otherSum)
  }

  return result
}

export function buildTrendDeltaSeries(
  chartData: BarChartData,
  windowMonths: string[],
): {
  deltaMonths: string[]
  series: { name: string; data: number[] }[]
} {
  const deltaMonths = trendDeltaMonths(windowMonths)
  const series = chartData.stacks.map((stack) => ({
    name: stack,
    data: deltaMonths.map((monthB, index) => {
      const monthA = windowMonths[index]!
      const a = chartData.data[monthA]?.[stack] ?? 0
      const b = chartData.data[monthB]?.[stack] ?? 0
      return b - a
    }),
  }))
  return { deltaMonths, series }
}

export function buildTrendVsAverageSeries(
  chartData: BarChartData,
  windowMonths: RollingWindowMonths,
  method: RollingAverageMethod = "mean",
): {
  deltaMonths: string[]
  series: { name: string; data: number[] }[]
} {
  const trendMonths = chartData.months.filter(
    (month) =>
      baselineMonthsInChart(chartData, month, windowMonths).length > 0,
  )

  const series = chartData.stacks.map((stack) => ({
    name: stack,
    data: trendMonths.map((month) => {
      const baselineMonths = baselineMonthsInChart(
        chartData,
        month,
        windowMonths,
      )
      const current = chartData.data[month]?.[stack] ?? 0
      const baseline = rollingBaselineAmount(
        chartData,
        stack,
        baselineMonths,
        method,
      )
      return current - baseline
    }),
  }))

  return { deltaMonths: trendMonths, series }
}

export function buildTrendChartSeries(
  chartData: BarChartData,
  compareMode: MomCompareMode,
  options: {
    rollingWindow: RollingWindowMonths
    rollingAverageMethod: RollingAverageMethod
  },
): {
  deltaMonths: string[]
  series: { name: string; data: number[] }[]
} {
  if (compareMode === "vs-average") {
    return buildTrendVsAverageSeries(
      chartData,
      options.rollingWindow,
      options.rollingAverageMethod,
    )
  }
  const spanMonths = monthSpanMonths(
    chartData.months[0] ?? "",
    chartData.months[chartData.months.length - 1] ?? "",
  )
  return buildTrendDeltaSeries(chartData, spanMonths.length > 0 ? spanMonths : chartData.months)
}

export function rankTrendStacksByActivity(
  chartData: BarChartData,
  windowMonths: string[],
  topN: number,
): { names: string[]; includesOther: boolean } {
  const activity = new Map<string, number>()
  const deltaMonths = trendDeltaMonths(windowMonths)

  for (const stack of chartData.stacks) {
    let sum = 0
    for (let i = 0; i < deltaMonths.length; i++) {
      const monthA = windowMonths[i]!
      const monthB = windowMonths[i + 1]!
      const a = chartData.data[monthA]?.[stack] ?? 0
      const b = chartData.data[monthB]?.[stack] ?? 0
      sum += Math.abs(b - a)
    }
    activity.set(stack, sum)
  }

  return rankStacksByAbsDelta(activity, topN)
}

export function rankTrendStacksByVsAverageActivity(
  chartData: BarChartData,
  windowMonths: RollingWindowMonths,
  method: RollingAverageMethod,
  topN: number,
): { names: string[]; includesOther: boolean } {
  const { series } = buildTrendVsAverageSeries(chartData, windowMonths, method)
  const activity = new Map<string, number>()
  for (const entry of series) {
    activity.set(
      entry.name,
      entry.data.reduce((sum, value) => sum + Math.abs(value), 0),
    )
  }
  return rankStacksByAbsDelta(activity, topN)
}

export function rankTrendChartStacks(
  chartData: BarChartData,
  compareMode: MomCompareMode,
  options: {
    rollingWindow: RollingWindowMonths
    rollingAverageMethod: RollingAverageMethod
  },
  topN: number,
): { names: string[]; includesOther: boolean } {
  if (compareMode === "vs-average") {
    return rankTrendStacksByVsAverageActivity(
      chartData,
      options.rollingWindow,
      options.rollingAverageMethod,
      topN,
    )
  }
  const spanMonths = monthSpanMonths(
    chartData.months[0] ?? "",
    chartData.months[chartData.months.length - 1] ?? "",
  )
  return rankTrendStacksByActivity(
    chartData,
    spanMonths.length > 0 ? spanMonths : chartData.months,
    topN,
  )
}
