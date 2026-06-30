export type TrendViewMode = "total" | "category"

export const STORAGE_KEY = "ff3-trends-view-mode"

export function readTrendViewMode(): TrendViewMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "total") return "total"
  if (stored === "category") return "category"
  return "category"
}

export function writeTrendViewMode(mode: TrendViewMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
}
