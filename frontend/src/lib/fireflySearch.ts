export function openFireflySearch(baseUrl: string, filters: string): void {
  const url = `${baseUrl.replace(/\/$/, "")}/search?search=${encodeURIComponent(filters)}`
  window.open(url, "_blank", "noopener,noreferrer")
}

/** Display label for CC Payment budget in cash-flow charts. */
export const CC_PAYMENT_BUDGET_LABEL = "CC Payment"

const SERVER_CC_PAYMENT_BUDGET = "Credit Card Payment"

export type DrilldownSearchContext = {
  budget?: string
  category?: string
  payee?: string
  useCashFlowLabels: boolean
}

function getDrilldownBudgetFilter(
  displayName: string,
  useCashFlowLabels: boolean,
): string {
  if (displayName === "Uncategorized") return "has_any_budget:false"
  if (useCashFlowLabels && displayName === CC_PAYMENT_BUDGET_LABEL) {
    return `budget_is:"${quoteFilterValue(SERVER_CC_PAYMENT_BUDGET)}"`
  }
  if (useCashFlowLabels) {
    return getCashFlowNodeQueryString(`${displayName}_BUDGET`, displayName)
  }
  return getSpendingNodeQueryString(`${displayName} (B)`, displayName)
}

function getDrilldownCategoryFilter(
  displayName: string,
  useCashFlowLabels: boolean,
  budget?: string,
): string {
  if (displayName === "Uncategorized") return "has_any_category:false"
  if (useCashFlowLabels && budget === CC_PAYMENT_BUDGET_LABEL) {
    return `account_is:"${quoteFilterValue(displayName)}"`
  }
  if (useCashFlowLabels) {
    return getCashFlowNodeQueryString(`${displayName}_CAT`, displayName)
  }
  return getSpendingNodeQueryString(`${displayName} (C)`, displayName)
}

function getDrilldownPayeeFilter(
  displayName: string,
  useCashFlowLabels: boolean,
): string {
  if (displayName === "Uncategorized") return "has_any_destination_account:false"
  if (useCashFlowLabels) {
    return `destination_account_is:"${quoteFilterValue(displayName)}"`
  }
  return getSpendingNodeQueryString(`${displayName} (P)`, displayName)
}

/** Build a Firefly search query for bar/line drilldown scope (budget → category → payee). */
export function buildDrilldownFireflySearch(
  start: string,
  end: string,
  context: DrilldownSearchContext,
): string {
  const filters = buildDateRangeFilters(start, end)
  if (context.budget) {
    filters.push(
      getDrilldownBudgetFilter(context.budget, context.useCashFlowLabels),
    )
  }
  if (context.category) {
    filters.push(
      getDrilldownCategoryFilter(
        context.category,
        context.useCashFlowLabels,
        context.budget,
      ),
    )
  }
  if (context.payee) {
    filters.push(
      getDrilldownPayeeFilter(context.payee, context.useCashFlowLabels),
    )
  }
  return filters.filter(Boolean).join(" ")
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

export function getCashFlowNodeQueryString(
  nodeName: string,
  displayName: string,
): string {
  return getCashFlowNodeFilterForKey(nodeName, displayName)
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
