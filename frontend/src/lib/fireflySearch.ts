export function openFireflySearch(baseUrl: string, filters: string): void {
  const url = `${baseUrl.replace(/\/$/, "")}/search?search=${encodeURIComponent(filters)}`
  window.open(url, "_blank", "noopener,noreferrer")
}

export function quoteFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export function buildDateRangeFilters(start: string, end: string): string[] {
  return [`date_after:${start}`, `date_before:${end}`]
}

export function getSpendingNodeQueryString(
  nodeName: string,
  displayName: string,
): string {
  if (nodeName === "Other (C)") return ""
  let type = ""
  if (nodeName.endsWith("(B)")) type = "budget"
  else if (nodeName.endsWith("(C)")) type = "category"
  else if (nodeName.endsWith("(A)")) type = "account"
  else if (nodeName.endsWith("(P)")) type = "destination_account"
  if (!type) return ""
  if (displayName === "Uncategorized") return `has_any_${type}:false`
  return `${type}_is:"${quoteFilterValue(displayName)}"`
}

function getCashFlowNodeFilterForKey(
  key: string,
  displayName: string,
): string {
  if (key === "BankAccounts_BANK") return ""
  if (displayName === "Uncategorized") {
    if (key.endsWith("_BUDGET")) return "has_any_budget:false"
    if (key.endsWith("_CAT")) return "has_any_category:false"
  }
  if (key.endsWith("_BUDGET")) return `budget_is:"${quoteFilterValue(displayName)}"`
  if (key.endsWith("_CAT")) return `category_is:"${quoteFilterValue(displayName)}"`
  if (key.endsWith("_BANK") || key.endsWith("_SRC")) {
    return `account_is:"${quoteFilterValue(displayName)}"`
  }
  return ""
}

function getNodeFilterForKey(
  key: string,
  displayName: string,
): string {
  const spendingFilter = getSpendingNodeQueryString(key, displayName)
  if (spendingFilter) return spendingFilter
  return getCashFlowNodeFilterForKey(key, displayName)
}

export function buildFireflyFilters(
  baseFilters: string[],
  sourceKey: string,
  targetKey: string,
  nodeDisplay: Record<string, string>,
): string {
  const fromFilter = getNodeFilterForKey(
    sourceKey,
    nodeDisplay[sourceKey] ?? sourceKey,
  )
  const toFilter = getNodeFilterForKey(
    targetKey,
    nodeDisplay[targetKey] ?? targetKey,
  )
  return [...baseFilters, fromFilter, toFilter].filter(Boolean).join(" ")
}
