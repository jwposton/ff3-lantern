import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { isTrendCashOutflow } from "@/lib/spending"

vi.mock("@/components/BudgetBarReportPage", () => ({
  BudgetBarReportPage: ({
    filter,
    pageTitle,
    mainChartTitle,
    emptyMessage,
    yAxisName,
  }: {
    filter: (row: unknown) => boolean
    pageTitle: string
    mainChartTitle: string
    emptyMessage: string
    yAxisName: string
  }) => (
    <div
      data-testid="budget-bar-report"
      data-filter={filter === isTrendCashOutflow ? "cash-outflow" : "other"}
      data-page-title={pageTitle}
      data-main-chart-title={mainChartTitle}
      data-empty-message={emptyMessage}
      data-y-axis-name={yAxisName}
    />
  ),
}))

import { CashFlowBarPage } from "./CashFlowBarPage"

describe("CashFlowBarPage", () => {
  it("uses isTrendCashOutflow filter and cash outflow copy", () => {
    const { getByTestId } = render(<CashFlowBarPage />)
    const el = getByTestId("budget-bar-report")

    expect(el.getAttribute("data-filter")).toBe("cash-outflow")
    expect(el.getAttribute("data-page-title")).toBe("Cash Flow")
    expect(el.getAttribute("data-main-chart-title")).toBe(
      "Cash flow by month",
    )
    expect(el.getAttribute("data-empty-message")).toBe(
      "No cash outflow in this date range",
    )
    expect(el.getAttribute("data-y-axis-name")).toBe("Cash outflow")
  })
})
