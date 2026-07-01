/** Display label for uncategorized budget/category stacks across charts. */
export const UNCATEGORIZED_DISPLAY_NAME = "Uncategorized"

export function isUncategorizedDisplayName(name: string): boolean {
  return name === UNCATEGORIZED_DISPLAY_NAME
}

export function buildCategorizeQueuePath(start: string, end: string): string {
  const params = new URLSearchParams({ start, end })
  return `/manage/categorize?${params.toString()}`
}
