import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { isSpendingExpense } from "@/lib/spending"

vi.mock("@/components/BudgetLineReportPage", () => ({
  BudgetLineReportPage: ({
    filter,
    pageTitle,
    emptyMessage,
    lineChartTitle,
    yAxisName,
  }: {
    filter: (row: unknown) => boolean
    pageTitle: string
    emptyMessage: string
    lineChartTitle: string
    yAxisName: string
  }) => (
    <div
      data-testid="budget-line-report"
      data-filter={filter === isSpendingExpense ? "spending" : "other"}
      data-page-title={pageTitle}
      data-empty-message={emptyMessage}
      data-line-chart-title={lineChartTitle}
      data-y-axis-name={yAxisName}
    />
  ),
}))

import { SpendingLinePage } from "./SpendingLinePage"

describe("SpendingLinePage", () => {
  it("uses isSpendingExpense filter and spending empty copy", () => {
    const { getByTestId } = render(<SpendingLinePage />)
    const el = getByTestId("budget-line-report")

    expect(el.getAttribute("data-filter")).toBe("spending")
    expect(el.getAttribute("data-page-title")).toBe("Spending")
    expect(el.getAttribute("data-empty-message")).toBe(
      "No spending in this date range",
    )
    expect(el.getAttribute("data-line-chart-title")).toBe(
      "Spending trends by month",
    )
    expect(el.getAttribute("data-y-axis-name")).toBe("Spending")
  })
})

describe("routes", () => {
  it("registers reports/spending/trends to SpendingLinePage", async () => {
    const { router } = await import("@/routes")
    const spendingTrendsRoute = router.routes[0]?.children?.find(
      (route) =>
        route.path === "reports/spending/trends" ||
        (typeof route.path === "string" &&
          route.path.includes("spending/trends")),
    )
    expect(spendingTrendsRoute).toBeDefined()
    expect(spendingTrendsRoute?.path).toBe("reports/spending/trends")
  })
})
