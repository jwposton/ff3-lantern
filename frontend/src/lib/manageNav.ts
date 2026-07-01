/** Display label for uncategorized budget/category stacks across charts. */
export const UNCATEGORIZED_DISPLAY_NAME = "Uncategorized"

export function isUncategorizedDisplayName(name: string): boolean {
  return name === UNCATEGORIZED_DISPLAY_NAME
}

export function buildCategorizeQueuePath(start: string, end: string): string {
  const params = new URLSearchParams({ start, end })
  return `/manage/categorize?${params.toString()}`
}

export function buildSpendingBarPath(
  start: string,
  end: string,
  budget?: string,
): string {
  const params = new URLSearchParams({ start, end })
  if (budget != null && budget !== "") {
    params.set("budget", budget)
  }
  return `/reports/spending?${params.toString()}`
}

export function buildCashFlowBarPath(
  start: string,
  end: string,
  budget?: string,
): string {
  const params = new URLSearchParams({ start, end })
  if (budget != null && budget !== "") {
    params.set("budget", budget)
  }
  return `/reports/cash-flow?${params.toString()}`
}
