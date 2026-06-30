export type TrendChartType = "line" | "stacked-bar"

export const CHART_TYPE_STORAGE_KEY = "ff3-trends-chart-type"

export function readTrendChartType(): TrendChartType {
  const stored = localStorage.getItem(CHART_TYPE_STORAGE_KEY)
  if (stored === "line") return "line"
  if (stored === "stacked-bar") return "stacked-bar"
  return "line"
}

export function writeTrendChartType(type: TrendChartType): void {
  localStorage.setItem(CHART_TYPE_STORAGE_KEY, type)
}
