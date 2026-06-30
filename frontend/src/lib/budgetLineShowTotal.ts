export const STORAGE_KEY = "ff3-budget-line-show-total"

export function readBudgetLineShowTotal(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "false") return false
  if (stored === "true") return true
  return true
}

export function writeBudgetLineShowTotal(show: boolean): void {
  localStorage.setItem(STORAGE_KEY, show ? "true" : "false")
}
