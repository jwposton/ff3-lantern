import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { spendingRowsForTotal } from "@/test/fixtures/omniRows"

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
    onSliceSelect,
  }: {
    chartTitle?: string
    onSliceSelect?: (name: string) => void
  }) => (
    <div data-testid="budget-spend-pie-chart">
      {chartTitle}
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
    onSelect,
  }: {
    chartTitle?: string
    onSelect?: (name: string) => void
  }) => (
    <div data-testid="budget-current-vs-average-chart">
      {chartTitle}
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

describe("DashboardTiles", () => {
  afterEach(() => {
    cleanup()
    mockNavigate.mockReset()
  })

  beforeEach(() => {
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
    expect(screen.queryByText("Total spending")).toBeNull()
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
          averageRows={spendingRowsForTotal}
          averageStart="2023-01-01"
          averageEnd="2024-01-31"
          isRangeLoading={false}
          isAverageLoading={false}
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText("Total spending")).toBeTruthy()
    expect(screen.getByText("75.50")).toBeTruthy()
    expect(screen.getByText("Food")).toBeTruthy()
    expect(screen.getByText("Top category")).toBeTruthy()
    expect(screen.getByTestId("budget-spend-pie-chart")).toBeTruthy()
    expect(screen.getByTestId("budget-current-vs-average-chart")).toBeTruthy()
  })

  it("navigates to spending bar with budget when pie slice is selected", () => {
    render(
      <MemoryRouter>
        <DashboardTiles
          rangeRows={spendingRowsForTotal}
          rangeStart="2024-01-01"
          rangeEnd="2024-01-31"
          averageRows={spendingRowsForTotal}
          averageStart="2023-01-01"
          averageEnd="2024-01-31"
          isRangeLoading={false}
          isAverageLoading={false}
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByTestId("pie-drill-budget"))
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
          averageRows={spendingRowsForTotal}
          averageStart="2023-01-01"
          averageEnd="2024-01-31"
          isRangeLoading={false}
          isAverageLoading={false}
          isError={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByTestId("pie-drill-uncategorized"))
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
          averageRows={spendingRowsForTotal}
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
