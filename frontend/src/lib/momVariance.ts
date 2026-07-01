import type { BarChartData } from "@/lib/barChart"

const OTHER_LABEL = "Other"

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
