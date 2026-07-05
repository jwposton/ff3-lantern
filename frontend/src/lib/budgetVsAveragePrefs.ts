export type BudgetVsAverageRankMode = "total-spend" | "change-vs-average"
export type BudgetVsAverageDisplayMode = "dollars" | "percent-of-average"

export const DEFAULT_BUDGET_VS_AVERAGE_RANK_MODE: BudgetVsAverageRankMode =
  "change-vs-average"
export const DEFAULT_BUDGET_VS_AVERAGE_DISPLAY_MODE: BudgetVsAverageDisplayMode =
  "dollars"

const RANK_MODE_KEY = "ff3-dashboard-budget-vs-average-rank-mode"
const DISPLAY_MODE_KEY = "ff3-dashboard-budget-vs-average-display-mode"

function parseRankMode(value: string | null): BudgetVsAverageRankMode {
  return value === "total-spend" ? "total-spend" : DEFAULT_BUDGET_VS_AVERAGE_RANK_MODE
}

function parseDisplayMode(value: string | null): BudgetVsAverageDisplayMode {
  return value === "percent-of-average"
    ? "percent-of-average"
    : DEFAULT_BUDGET_VS_AVERAGE_DISPLAY_MODE
}

export function readBudgetVsAverageRankMode(): BudgetVsAverageRankMode {
  return parseRankMode(localStorage.getItem(RANK_MODE_KEY))
}

export function writeBudgetVsAverageRankMode(mode: BudgetVsAverageRankMode): void {
  localStorage.setItem(RANK_MODE_KEY, mode)
}

export function readBudgetVsAverageDisplayMode(): BudgetVsAverageDisplayMode {
  return parseDisplayMode(localStorage.getItem(DISPLAY_MODE_KEY))
}

export function writeBudgetVsAverageDisplayMode(
  mode: BudgetVsAverageDisplayMode,
): void {
  localStorage.setItem(DISPLAY_MODE_KEY, mode)
}
