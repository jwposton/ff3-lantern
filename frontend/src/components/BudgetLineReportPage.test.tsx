import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"

import type { TrendLineSeries } from "@/lib/barChart"
import { TOTAL_LABEL } from "@/lib/barChart"
import { creditCardPaymentTransfer } from "@/test/fixtures/omniRows"

import { BudgetLineReportPage } from "./BudgetLineReportPage"

const mockUseDateRange = vi.fn()
const mockUseNormalizedTransactions = vi.fn()
let capturedSeries: TrendLineSeries[] | null = null

vi.mock("@/context/DateRangeContext", () => ({
  useDateRange: () => mockUseDateRange(),
}))

vi.mock("@/hooks/useNormalizedTransactions", () => ({
  useNormalizedTransactions: (...args: unknown[]) =>
    mockUseNormalizedTransactions(...args),
}))

vi.mock("@/lib/budgetLineShowTotal", () => ({
  readBudgetLineShowTotal: () => true,
  writeBudgetLineShowTotal: vi.fn(),
}))

vi.mock("@/components/BudgetLineChart", () => ({
  BudgetLineChart: ({
    series,
    emptyMessage,
    loading,
    onSelect,
  }: {
    series: TrendLineSeries[]
    emptyMessage: string
    loading: boolean
    onSelect: (budget: string) => void
  }) => {
    capturedSeries = series
    return loading ? (
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
    )
  },
}))

vi.mock("@/components/BudgetDrilldownBarChart", () => ({
  BudgetDrilldownBarChart: ({ budget }: { budget: string }) => (
    <div data-testid="drilldown">{budget}</div>
  ),
}))

const pageProps = {
  pageTitle: "Spending",
  lineChartTitle: "Spending trends by month",
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
      <BudgetLineReportPage filter={alwaysTrue} {...pageProps} />
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

describe("BudgetLineReportPage", () => {
  afterEach(() => {
    cleanup()
    capturedSeries = null
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

  it("shows Show total toggle and toggling changes series passed to BudgetLineChart", () => {
    render(<BudgetLineReportPage filter={alwaysTrue} {...pageProps} />)

    const toggle = screen.getByLabelText("Show total")
    expect(toggle).toBeTruthy()
    expect((toggle as HTMLInputElement).checked).toBe(true)
    expect(capturedSeries?.some((s) => s.name === TOTAL_LABEL)).toBe(true)

    fireEvent.click(toggle)
    expect(capturedSeries?.some((s) => s.name === TOTAL_LABEL)).toBe(false)
  })

  it("renders emptyMessage from props when slice rows empty", () => {
    render(<BudgetLineReportPage filter={alwaysFalse} {...pageProps} />)

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
})
