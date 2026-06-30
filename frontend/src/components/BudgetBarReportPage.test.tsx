import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"

import { creditCardPaymentTransfer } from "@/test/fixtures/omniRows"

import { BudgetBarReportPage } from "./BudgetBarReportPage"

const mockUseDateRange = vi.fn()
const mockUseNormalizedTransactions = vi.fn()

vi.mock("@/context/DateRangeContext", () => ({
  useDateRange: () => mockUseDateRange(),
}))

vi.mock("@/hooks/useNormalizedTransactions", () => ({
  useNormalizedTransactions: (...args: unknown[]) =>
    mockUseNormalizedTransactions(...args),
}))

vi.mock("@/components/SpendingBarChart", () => ({
  SpendingBarChart: ({
    emptyMessage,
    loading,
    onSelect,
  }: {
    emptyMessage: string
    loading: boolean
    onSelect: (budget: string) => void
  }) =>
    loading ? (
      <div data-testid="chart-loading" />
    ) : (
      <div>
        <div data-testid="empty-message">{emptyMessage}</div>
        <button
          type="button"
          data-testid="select-budget"
          onClick={() => onSelect("Groceries")}
        >
          Select budget
        </button>
      </div>
    ),
}))

vi.mock("@/components/BudgetDrilldownBarChart", () => ({
  BudgetDrilldownBarChart: ({ budget }: { budget: string }) => (
    <div data-testid="drilldown">{budget}</div>
  ),
}))

const pageProps = {
  pageTitle: "Spending",
  mainChartTitle: "Spending by month",
  emptyMessage: "No spending in this date range",
  yAxisName: "Spending",
} as const

const alwaysFalse = () => false
const alwaysTrue = () => true

function DateRangeHarness() {
  const [range, setRange] = useState({
    start: "2026-01-01",
    end: "2026-01-31",
  })
  mockUseDateRange.mockReturnValue({ committedRange: range })

  return (
    <>
      <BudgetBarReportPage filter={alwaysTrue} {...pageProps} />
      <button
        type="button"
        data-testid="change-range"
        onClick={() =>
          setRange({ start: "2026-02-01", end: "2026-02-28" })
        }
      >
        Change range
      </button>
    </>
  )
}

describe("BudgetBarReportPage", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mockUseDateRange.mockReturnValue({
      committedRange: { start: "2026-01-01", end: "2026-01-31" },
    })
    mockUseNormalizedTransactions.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: [creditCardPaymentTransfer] },
      refetch: vi.fn(),
    })
  })

  it("renders SpendingBarChart emptyMessage from props when slice rows empty", () => {
    render(
      <BudgetBarReportPage filter={alwaysFalse} {...pageProps} />,
    )

    expect(screen.getByTestId("empty-message").textContent).toBe(
      "No spending in this date range",
    )
  })

  it("clears selectedBudget when committed date range changes", () => {
    render(<DateRangeHarness />)

    fireEvent.click(screen.getByTestId("select-budget"))
    expect(screen.getByTestId("drilldown").textContent).toBe("Groceries")

    fireEvent.click(screen.getByTestId("change-range"))
    expect(screen.queryByTestId("drilldown")).toBeNull()
  })

  it("shows BudgetDrilldownBarChart when onSelect sets budget", () => {
    render(<BudgetBarReportPage filter={alwaysTrue} {...pageProps} />)

    fireEvent.click(screen.getByTestId("select-budget"))
    expect(screen.getByTestId("drilldown").textContent).toBe("Groceries")
  })
})
