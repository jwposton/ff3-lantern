import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { creditCardPaymentTransfer, mainCheckingWithdrawal } from "@/test/fixtures/omniRows"

import { MomVarianceReportPage } from "./MomVarianceReportPage"

const mockUseDateRange = vi.fn()
const mockUseNormalizedTransactions = vi.fn()

vi.mock("@/context/DateRangeContext", () => ({
  useDateRange: () => mockUseDateRange(),
}))

vi.mock("@/hooks/useNormalizedTransactions", () => ({
  useNormalizedTransactions: (...args: unknown[]) =>
    mockUseNormalizedTransactions(...args),
}))

vi.mock("@/components/MomTrendChart", () => ({
  MomTrendChart: ({
    chartTitle,
    loading,
    series,
    onSelect,
    embedded,
  }: {
    chartTitle: string
    loading: boolean
    series: { name: string; data: number[] }[]
    onSelect?: (name: string) => void
    embedded?: boolean
  }) => {
    if (loading) {
      return <div data-testid="mom-trend-loading" />
    }
    if (embedded) {
      return (
        <div data-testid="mom-trend-chart-embedded">
          <span data-testid="embedded-series-count">{series.length}</span>
        </div>
      )
    }
    return (
      <div data-testid="mom-trend-chart-mock">
        <span>{chartTitle}</span>
        <span data-testid="series-count">{series.length}</span>
        {onSelect ? (
          <button
            type="button"
            data-testid="trend-drill-trigger"
            onClick={() => onSelect("Groceries")}
          >
            Drill budget
          </button>
        ) : null}
      </div>
    )
  },
}))

vi.mock("@/components/MomCompareChart", () => ({
  MomCompareChart: ({
    chartTitle,
    loading,
    sortedNames,
    emptyMessage,
    onSelect,
    embedded,
  }: {
    chartTitle: string
    loading: boolean
    sortedNames: string[]
    emptyMessage: string
    onSelect?: (name: string) => void
    embedded?: boolean
  }) => {
    if (loading) {
      return <div data-testid="mom-compare-loading" />
    }
    if (embedded) {
      return (
        <div data-testid="mom-compare-chart-embedded">
          <span data-testid="embedded-compare-names-count">
            {sortedNames.length}
          </span>
        </div>
      )
    }
    if (sortedNames.length === 0) {
      return <div data-testid="mom-compare-empty">{emptyMessage}</div>
    }
    return (
      <div data-testid="mom-compare-chart-mock">
        <span>{chartTitle}</span>
        <span data-testid="compare-names-count">{sortedNames.length}</span>
        {onSelect ? (
          <button
            type="button"
            data-testid="compare-drill-trigger"
            onClick={() => onSelect("Groceries")}
          >
            Drill budget
          </button>
        ) : null}
      </div>
    )
  },
}))

const pageProps = {
  pageTitle: "Spending",
  emptyMessage: "No spending in this date range",
  compareEmptyMessage:
    "Select a range spanning at least two months to compare months",
  momTopNFamily: "spending" as const,
  trendChartTitle: "MoM spending change",
  compareChartTitle: "Month-over-month spending change",
  yAxisNameTrend: "Δ spending",
  yAxisNameCompare: "Δ spending",
  interactionHintTrend: "Click a budget line to drill down by category.",
  interactionHintCompare: "Click a bar to drill down by category.",
  tabTrendLabel: "Trend",
  tabCompareLabel: "Compare",
  topNLabel: "Budgets shown:",
}

const alwaysTrue = () => true

const groceriesRows = [
  {
    ...mainCheckingWithdrawal,
    budget: "Groceries",
    category: "Food",
    date: "2024-01-15",
    amount: "100.00",
  },
  {
    ...mainCheckingWithdrawal,
    budget: "Groceries",
    category: "Food",
    date: "2024-02-15",
    amount: "150.00",
  },
  {
    ...mainCheckingWithdrawal,
    budget: "Groceries",
    category: "Household",
    date: "2024-01-20",
    amount: "50.00",
  },
  {
    ...mainCheckingWithdrawal,
    budget: "Groceries",
    category: "Household",
    date: "2024-02-20",
    amount: "30.00",
  },
  {
    ...mainCheckingWithdrawal,
    budget: "Transport",
    category: "Fuel",
    date: "2024-01-10",
    amount: "40.00",
  },
  {
    ...mainCheckingWithdrawal,
    budget: "Transport",
    category: "Fuel",
    date: "2024-02-10",
    amount: "60.00",
  },
]

describe("MomVarianceReportPage", () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  beforeEach(() => {
    mockUseDateRange.mockReturnValue({
      committedRange: { start: "2024-01-01", end: "2024-03-31" },
    })
    mockUseNormalizedTransactions.mockImplementation(() => ({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: [creditCardPaymentTransfer] },
      refetch: vi.fn(),
    }))
    localStorage.clear()
  })

  it("renders Compare tab active with MomCompareChart by default", () => {
    render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    expect(screen.getByRole("button", { name: "Compare" })).toBeTruthy()
    expect(screen.getByTestId("mom-compare-chart-mock")).toBeTruthy()
    expect(screen.queryByTestId("mom-trend-chart-mock")).toBeNull()
  })

  it("renders MomTrendChart when Trend tab selected", () => {
    render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Trend" }))

    expect(screen.getByTestId("mom-trend-chart-mock")).toBeTruthy()
    expect(screen.getByText("MoM spending change")).toBeTruthy()
    expect(screen.queryByTestId("mom-compare-chart-mock")).toBeNull()
  })

  it("shows vs Average controls on Compare tab by default", () => {
    render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    expect(screen.getByText("Current month")).toBeTruthy()
    expect(screen.getByText("Avg window")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Mean" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Median" })).toBeTruthy()
    expect(screen.queryByText("Month A")).toBeNull()
    expect(screen.queryByText("Month B")).toBeNull()
  })

  it("shows month pair selectors when vs Month mode selected", () => {
    render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    fireEvent.click(screen.getByRole("button", { name: "vs Month" }))

    expect(screen.getByText("Month A")).toBeTruthy()
    expect(screen.getByText("Month B")).toBeTruthy()
    expect(screen.queryByText("Current month")).toBeNull()
  })

  it("applies defaultMonthPair in vs Month mode", () => {
    render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    fireEvent.click(screen.getByRole("button", { name: "vs Month" }))

    const selects = screen.getAllByRole("combobox")
    expect((selects[0] as HTMLSelectElement).value).toBe("2024-02")
    expect((selects[1] as HTMLSelectElement).value).toBe("2024-03")
  })

  it("shows error banner when fetch fails", () => {
    mockUseNormalizedTransactions.mockImplementation(() => ({
      isPending: false,
      isError: true,
      isSuccess: false,
      data: undefined,
      refetch: vi.fn(),
    }))

    render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    expect(screen.getByRole("alert")).toBeTruthy()
    expect(screen.getByText("Unable to load transactions")).toBeTruthy()
  })

  it("renders Top-N slider with Budgets shown label", () => {
    render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    expect(screen.getByText("Budgets shown:")).toBeTruthy()
    const slider = screen.getByRole("slider")
    expect(slider.getAttribute("min")).toBe("10")
    expect(slider.getAttribute("max")).toBe("25")
  })

  it("shows compare empty copy when range has fewer than two months in vs Month mode", () => {
    mockUseDateRange.mockReturnValue({
      committedRange: { start: "2024-03-01", end: "2024-03-31" },
    })

    render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    fireEvent.click(screen.getByRole("button", { name: "vs Month" }))

    expect(
      screen.getByText(
        "Select a range spanning at least two months to compare months",
      ),
    ).toBeTruthy()
  })

  describe("drilldown", () => {
    beforeEach(() => {
      mockUseNormalizedTransactions.mockImplementation(() => ({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: { data: groceriesRows },
        refetch: vi.fn(),
      }))
    })

    it("opens category drilldown card when budget selected on Trend tab", () => {
      render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "Trend" }))
      fireEvent.click(screen.getByTestId("trend-drill-trigger"))

      expect(screen.getByText("Groceries breakdown")).toBeTruthy()
      expect(screen.getByTestId("mom-trend-chart-embedded")).toBeTruthy()
      expect(screen.getByTestId("embedded-series-count").textContent).not.toBe(
        "0",
      )
      expect(screen.getByText("Categories shown:")).toBeTruthy()
    })

    it("opens category drilldown from Compare tab with compare chart type", () => {
      render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByTestId("compare-drill-trigger"))

      expect(screen.getByText("Groceries breakdown")).toBeTruthy()
      expect(screen.getByTestId("mom-compare-chart-embedded")).toBeTruthy()
    })

    it("hides drilldown when Clear is clicked", () => {
      render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "Trend" }))
      fireEvent.click(screen.getByTestId("trend-drill-trigger"))
      expect(screen.getByText("Groceries breakdown")).toBeTruthy()

      fireEvent.click(
        screen.getByRole("button", { name: "Clear MoM drilldown" }),
      )

      expect(screen.queryByText("Groceries breakdown")).toBeNull()
      expect(screen.getByText("Budgets shown:")).toBeTruthy()
    })

    it("clears drill when Top-N slider changes", () => {
      render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "Trend" }))
      fireEvent.click(screen.getByTestId("trend-drill-trigger"))
      expect(screen.getByText("Groceries breakdown")).toBeTruthy()

      fireEvent.change(screen.getByRole("slider"), { target: { value: "12" } })

      expect(screen.queryByText("Groceries breakdown")).toBeNull()
    })

    it("preserves selectedBudget when switching tabs while drilled", () => {
      render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "Trend" }))
      fireEvent.click(screen.getByTestId("trend-drill-trigger"))
      expect(screen.getByTestId("mom-trend-chart-embedded")).toBeTruthy()

      fireEvent.click(screen.getByRole("button", { name: "Compare" }))

      expect(screen.getByText("Groceries breakdown")).toBeTruthy()
      expect(screen.queryByTestId("mom-trend-chart-embedded")).toBeNull()
      expect(screen.getByTestId("mom-compare-chart-embedded")).toBeTruthy()
    })

    it("clears drill when committed date range changes", () => {
      const { rerender } = render(
        <MomVarianceReportPage filter={alwaysTrue} {...pageProps} />,
      )

      fireEvent.click(screen.getByRole("button", { name: "Trend" }))
      fireEvent.click(screen.getByTestId("trend-drill-trigger"))
      expect(screen.getByText("Groceries breakdown")).toBeTruthy()

      mockUseDateRange.mockReturnValue({
        committedRange: { start: "2024-04-01", end: "2024-06-30" },
      })
      rerender(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      expect(screen.queryByText("Groceries breakdown")).toBeNull()
    })

    it("keeps drill when month A/B changes on Compare tab in vs Month mode", () => {
      render(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "vs Month" }))
      fireEvent.click(screen.getByTestId("compare-drill-trigger"))
      expect(screen.getByText("Groceries breakdown")).toBeTruthy()

      const selects = screen.getAllByRole("combobox")
      fireEvent.change(selects[0]!, { target: { value: "2024-01" } })

      expect(screen.getByText("Groceries breakdown")).toBeTruthy()
    })
  })
})
