import type { BarChartData } from "@/lib/barChart"
import type { DateRange } from "@/lib/dateRange"
import type {
  RollingAverageMethod,
  RollingWindowMonths,
} from "@/lib/momComparePrefs"

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

export function currentCalendarMonth(now: Date = new Date()): string {
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

export function compareToRollingAverage(
  chartData: BarChartData,
  currentMonth: string,
  windowMonths: RollingWindowMonths,
  method: RollingAverageMethod = "mean",
): Map<string, number> {
  const baselineMonths = rollingMonthsBefore(currentMonth, windowMonths).filter(
    (month) => chartData.months.includes(month),
  )
  const deltas = new Map<string, number>()

  if (baselineMonths.length === 0) {
    return deltas
  }

  for (const stack of chartData.stacks) {
    const current = chartData.data[currentMonth]?.[stack] ?? 0
    const baseline = rollingBaselineAmount(
      chartData,
      stack,
      baselineMonths,
      method,
    )
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
  maxMonths = 6,
): string[] {
  if (months.length <= maxMonths) return months
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
