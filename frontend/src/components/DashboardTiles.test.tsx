import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import {
  creditCardPaymentTransfer,
  creditCardWithdrawal,
  mainCheckingWithdrawal,
  salaryDeposit,
  spendingRowsForTotal,
} from "@/test/fixtures/omniRows"

import { DashboardTiles } from "./DashboardTiles"

const mockNavigate = vi.fn()

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock("@/components/BudgetSpendPieChart", () => ({
  BudgetSpendPieChart: ({
    chartTitle,
    chartSubtitle,
    chartTestId,
    onSliceSelect,
  }: {
    chartTitle?: string
    chartSubtitle?: string
    chartTestId?: string
    onSliceSelect?: (name: string) => void
  }) => (
    <div data-testid={chartTestId ?? "budget-spend-pie-chart"}>
      <span>{chartTitle}</span>
      <span>{chartSubtitle}</span>
      {onSliceSelect ? (
        <>
          <button
            type="button"
            data-testid="pie-drill-budget"
            onClick={() => onSliceSelect("Food")}
          >
            Drill budget
          </button>
          <button
            type="button"
            data-testid="pie-drill-uncategorized"
            onClick={() => onSliceSelect("Uncategorized")}
          >
            Drill uncategorized
          </button>
        </>
      ) : null}
    </div>
  ),
}))

vi.mock("@/components/BudgetCurrentVsAverageChart", () => ({
  BudgetCurrentVsAverageChart: ({
    chartTitle,
    chartSubtitle,
    onSelect,
  }: {
    chartTitle?: string
    chartSubtitle?: string
    onSelect?: (name: string) => void
  }) => (
    <div data-testid="budget-current-vs-average-chart">
      <span>{chartTitle}</span>
      <span>{chartSubtitle}</span>
      {onSelect ? (
        <button
          type="button"
          data-testid="bar-drill-budget"
          onClick={() => onSelect("Food")}
        >
          Drill budget
        </button>
      ) : null}
    </div>
  ),
}))

const JANUARY_CASH_FLOW_ROWS = [
  salaryDeposit,
  mainCheckingWithdrawal,
  creditCardWithdrawal,
  creditCardPaymentTransfer,
]

describe("DashboardTiles", () => {
  afterEach(() => {
    cleanup()
    mockNavigate.mockReset()
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2024-01-15T12:00:00"))
    mockNavigate.mockReset()
  })

  it("shows skeleton placeholders while loading", () => {
    render(
      <MemoryRouter>
        <DashboardTiles
          rangeRows={[]}
          rangeStart="2024-01-01"
          rangeEnd="2024-01-31"
          averageRows={[]}
          averageStart="2023-01-01"
          averageEnd="2024-01-31"
          isRangeLoading
          isAverageLoading
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getAllByText("Monthly cash flow").length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText("5,000.00")).toBeNull()
    expect(screen.queryByText("Unable to load transactions")).toBeNull()
  })

  it("shows error banner and Retry when isError", () => {
    const onRetry = vi.fn()
    render(
      <MemoryRouter>
        <DashboardTiles
          rangeRows={[]}
          rangeStart="2024-01-01"
          rangeEnd="2024-01-31"
          averageRows={[]}
          averageStart="2023-01-01"
          averageEnd="2024-01-31"
          isRangeLoading={false}
          isAverageLoading={false}
          isError
          onRetry={onRetry}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText("Unable to load transactions")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("renders KPIs and chart tiles on success", () => {
    render(
      <MemoryRouter>
        <DashboardTiles
          rangeRows={spendingRowsForTotal}
          rangeStart="2024-01-01"
          rangeEnd="2024-01-31"
          averageRows={JANUARY_CASH_FLOW_ROWS}
          averageStart="2023-01-01"
          averageEnd="2024-01-31"
          isRangeLoading={false}
          isAverageLoading={false}
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText("This month")).toBeTruthy()
    expect(screen.getByText("Selected period")).toBeTruthy()
    expect(screen.getAllByText("Monthly cash flow").length).toBe(2)
    expect(screen.getAllByText("January 2024").length).toBeGreaterThanOrEqual(4)
    expect(screen.getAllByText("Income").length).toBe(2)
    expect(screen.getAllByText("Net cash flow").length).toBe(2)
    expect(screen.getAllByText("Total spending").length).toBe(2)
    expect(screen.getByText("5,000.00")).toBeTruthy()
    expect(screen.getByText("+4,724.50")).toBeTruthy()
    expect(screen.getAllByText("175.50").length).toBe(2)
    expect(screen.getAllByText("Spending by budget").length).toBe(2)
    expect(screen.getByText("Cash flow by budget")).toBeTruthy()
    expect(screen.getByText("Budget vs 12-month average")).toBeTruthy()
    expect(screen.getByTestId("spending-pie-current-month")).toBeTruthy()
    expect(screen.getByTestId("spending-pie-selected-period")).toBeTruthy()
    expect(screen.getByTestId("cash-flow-pie-selected-period")).toBeTruthy()
    expect(screen.getByTestId("budget-current-vs-average-chart")).toBeTruthy()
  })

  it("navigates to spending bar for selected period when period pie slice is selected", () => {
    render(
      <MemoryRouter>
        <DashboardTiles
          rangeRows={spendingRowsForTotal}
          rangeStart="2024-06-01"
          rangeEnd="2024-06-30"
          averageRows={JANUARY_CASH_FLOW_ROWS}
          averageStart="2023-01-01"
          averageEnd="2024-01-31"
          isRangeLoading={false}
          isAverageLoading={false}
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getAllByTestId("pie-drill-budget")[1]!)
    expect(mockNavigate).toHaveBeenCalledWith(
      "/reports/spending?start=2024-06-01&end=2024-06-30&budget=Food",
    )
  })

  it("navigates to spending bar for current month when current-month pie slice is selected", () => {
    render(
      <MemoryRouter>
        <DashboardTiles
          rangeRows={spendingRowsForTotal}
          rangeStart="2024-06-01"
          rangeEnd="2024-06-30"
          averageRows={JANUARY_CASH_FLOW_ROWS}
          averageStart="2023-01-01"
          averageEnd="2024-01-31"
          isRangeLoading={false}
          isAverageLoading={false}
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getAllByTestId("pie-drill-budget")[0]!)
    expect(mockNavigate).toHaveBeenCalledWith(
      "/reports/spending?start=2024-01-01&end=2024-01-31&budget=Food",
    )
  })

  it("navigates to categorize queue when uncategorized pie slice is selected", () => {
    render(
      <MemoryRouter>
        <DashboardTiles
          rangeRows={spendingRowsForTotal}
          rangeStart="2024-01-01"
          rangeEnd="2024-01-31"
          averageRows={JANUARY_CASH_FLOW_ROWS}
          averageStart="2023-01-01"
          averageEnd="2024-01-31"
          isRangeLoading={false}
          isAverageLoading={false}
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getAllByTestId("pie-drill-uncategorized")[1]!)
    expect(mockNavigate).toHaveBeenCalledWith(
      "/manage/categorize?start=2024-01-01&end=2024-01-31",
    )
  })

  it("navigates to spending bar when bar row is selected", () => {
    render(
      <MemoryRouter>
        <DashboardTiles
          rangeRows={spendingRowsForTotal}
          rangeStart="2024-01-01"
          rangeEnd="2024-01-31"
          averageRows={JANUARY_CASH_FLOW_ROWS}
          averageStart="2023-01-01"
          averageEnd="2024-01-31"
          isRangeLoading={false}
          isAverageLoading={false}
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByTestId("bar-drill-budget"))
    expect(mockNavigate).toHaveBeenCalledWith(
      "/reports/spending?start=2024-01-01&end=2024-01-31&budget=Food",
    )
  })
})
