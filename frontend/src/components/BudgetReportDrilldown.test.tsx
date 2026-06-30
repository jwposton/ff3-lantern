import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { mainCheckingWithdrawal } from "@/test/fixtures/omniRows"

import { BudgetReportDrilldown } from "./BudgetReportDrilldown"

vi.mock("echarts-for-react", () => ({
  default: ({
    onEvents,
  }: {
    onEvents?: Record<string, (params: unknown) => void>
  }) => (
    <div
      data-testid="echarts-mock"
      onClick={() => onEvents?.click?.({ seriesName: "Food" })}
    />
  ),
}))

const rows = [
  mainCheckingWithdrawal,
  {
    ...mainCheckingWithdrawal,
    date: "2024-01-16",
    destination_account: "Other Store",
    category: "Food",
    amount: "25.00",
  },
  {
    ...mainCheckingWithdrawal,
    date: "2024-01-17",
    category: "Transport",
    destination_account: "Gas Station",
    amount: "30.00",
  },
]

describe("BudgetReportDrilldown", () => {
  it("shows category chart, payee chart on select, and filtered transaction table", () => {
    render(
      <BudgetReportDrilldown
        rows={rows}
        start="2024-01-01"
        end="2024-01-31"
        budget="Essentials"
        chartType="line"
        yAxisName="Spending"
        fireflyBaseUrl="https://firefly.example"
        onClearBudget={() => {}}
      />,
    )

    expect(screen.getByText("Essentials by category")).toBeTruthy()
    expect(screen.getByText("Search in Firefly")).toBeTruthy()

    fireEvent.click(screen.getAllByTestId("echarts-mock")[0]!)

    expect(screen.getByText("Food by payee")).toBeTruthy()
    expect(screen.getByText(/\(2\)/)).toBeTruthy()
  })
})
