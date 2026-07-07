import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState, type ReactElement } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

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
    headerControls,
  }: {
    emptyMessage: string
    loading: boolean
    onSelect: (budget: string, rail?: string) => void
    headerControls?: React.ReactNode
  }) =>
    loading ? (
      <div data-testid="chart-loading" />
    ) : (
      <div>
        {headerControls}
        <div data-testid="empty-message">{emptyMessage}</div>
        <button
          type="button"
          data-testid="select-budget"
          onClick={() => onSelect("Groceries")}
        >
          Select budget
        </button>
        <button
          type="button"
          data-testid="select-budget-cash"
          onClick={() => onSelect("Groceries", "cash")}
        >
          Select cash rail
        </button>
      </div>
    ),
}))

vi.mock("@/components/BudgetReportDrilldown", () => ({
  BudgetReportDrilldown: ({
    budget,
    paymentRail,
  }: {
    budget: string
    paymentRail?: string
  }) => (
    <div data-testid="drilldown">
      {budget}
      {paymentRail ? `:${paymentRail}` : ""}
    </div>
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

function renderPage(
  ui: ReactElement,
  initialEntry = "/reports/spending?start=2026-01-01&end=2026-01-31",
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/reports/spending" element={ui} />
      </Routes>
    </MemoryRouter>,
  )
}

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
    renderPage(<BudgetBarReportPage filter={alwaysFalse} {...pageProps} />)

    expect(screen.getByTestId("empty-message").textContent).toBe(
      "No spending in this date range",
    )
  })

  it("clears selectedBudget when committed date range changes", () => {
    renderPage(<DateRangeHarness />)

    fireEvent.click(screen.getByTestId("select-budget"))
    expect(screen.getByTestId("drilldown").textContent).toBe("Groceries")

    fireEvent.click(screen.getByTestId("change-range"))
    expect(screen.queryByTestId("drilldown")).toBeNull()
  })

  it("shows BudgetReportDrilldown when onSelect sets budget", () => {
    renderPage(<BudgetBarReportPage filter={alwaysTrue} {...pageProps} />)

    fireEvent.click(screen.getByTestId("select-budget"))
    expect(screen.getByTestId("drilldown").textContent).toBe("Groceries")
  })

  it("pre-selects budget from URL search param", () => {
    renderPage(
      <BudgetBarReportPage filter={alwaysTrue} {...pageProps} />,
      "/reports/spending?start=2026-01-01&end=2026-01-31&budget=Groceries",
    )

    expect(screen.getByTestId("drilldown").textContent).toBe("Groceries")
  })

  it("shows view controls and selects split mode", () => {
    renderPage(
      <BudgetBarReportPage
        filter={alwaysTrue}
        {...pageProps}
        enablePaymentRailSplit
      />,
      "/reports/spending?start=2026-01-01&end=2026-01-31",
    )

    expect(screen.getByRole("group", { name: "Spending chart view" })).toBeTruthy()
    const splitButton = screen.getByRole("button", { name: "Cash & Credit" })
    fireEvent.click(splitButton)
    expect(splitButton.getAttribute("aria-pressed")).toBe("true")
  })

  it("drills with payment rail when bar selection includes rail", () => {
    renderPage(
      <BudgetBarReportPage
        filter={alwaysTrue}
        {...pageProps}
        enablePaymentRailSplit
      />,
      "/reports/spending?start=2026-01-01&end=2026-01-31&view=split",
    )

    fireEvent.click(screen.getByTestId("select-budget-cash"))
    expect(screen.getByTestId("drilldown").textContent).toBe("Groceries:cash")
  })

  it("clears payment rail from drilldown when switching to Combined view", () => {
    renderPage(
      <BudgetBarReportPage
        filter={alwaysTrue}
        {...pageProps}
        enablePaymentRailSplit
      />,
      "/reports/spending?start=2026-01-01&end=2026-01-31&view=split",
    )

    fireEvent.click(screen.getByTestId("select-budget-cash"))
    expect(screen.getByTestId("drilldown").textContent).toBe("Groceries:cash")

    fireEvent.click(screen.getByRole("button", { name: "Combined" }))
    expect(screen.getByTestId("drilldown").textContent).toBe("Groceries")
  })

  it("ignores stale rail param when view is Combined", () => {
    renderPage(
      <BudgetBarReportPage
        filter={alwaysTrue}
        {...pageProps}
        enablePaymentRailSplit
      />,
      "/reports/spending?start=2026-01-01&end=2026-01-31&budget=Groceries&rail=cash",
    )

    expect(screen.getByTestId("drilldown").textContent).toBe("Groceries")
  })
})
