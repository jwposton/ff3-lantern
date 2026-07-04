import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { creditCardPaymentTransfer, mainCheckingWithdrawal } from "@/test/fixtures/omniRows"

import { MomVarianceReportPage } from "./MomVarianceReportPage"

const mockNavigate = vi.fn()
const mockUseDateRange = vi.fn()
const mockUseNormalizedTransactions = vi.fn()

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

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
          <>
            <button
              type="button"
              data-testid="trend-drill-trigger"
              onClick={() => onSelect("Groceries")}
            >
              Drill budget
            </button>
            <button
              type="button"
              data-testid="trend-uncategorized-trigger"
              onClick={() => onSelect("Uncategorized")}
            >
              Drill uncategorized
            </button>
          </>
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

function renderVariancePage(ui: ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/reports/spending/mom"]}>{ui}</MemoryRouter>,
  )
}

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
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.setSystemTime(new Date(2024, 2, 15))
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
    renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    expect(screen.getByRole("button", { name: "Compare" })).toBeTruthy()
    expect(screen.getByTestId("mom-compare-chart-mock")).toBeTruthy()
    expect(screen.queryByTestId("mom-trend-chart-mock")).toBeNull()
  })

  it("renders MomTrendChart when Trend tab selected", () => {
    renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Trend" }))

    expect(screen.getByTestId("mom-trend-chart-mock")).toBeTruthy()
    expect(screen.getByText("MoM spending change")).toBeTruthy()
    expect(screen.queryByTestId("mom-compare-chart-mock")).toBeNull()
  })

  it("shows vs Average controls on Compare tab by default", () => {
    renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    expect(screen.getByText("Current month")).toBeTruthy()
    expect(screen.getByText("Avg window")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Mean" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Median" })).toBeTruthy()
    expect(screen.queryByText("Month A")).toBeNull()
    expect(screen.queryByText("Month B")).toBeNull()
  })

  it("shows month pair selectors when vs Month mode selected on Compare tab", () => {
    renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    fireEvent.click(screen.getByRole("button", { name: "vs Month" }))

    expect(screen.getByText("Month A")).toBeTruthy()
    expect(screen.getByText("Month B")).toBeTruthy()
    expect(screen.queryByText("Current month")).toBeNull()
    expect(screen.queryByText("Range")).toBeNull()
  })

  it("applies defaultMonthPair in vs Month compare mode", () => {
    renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    fireEvent.click(screen.getByRole("button", { name: "vs Month" }))

    const selects = screen.getAllByRole("combobox")
    expect((selects[0] as HTMLSelectElement).value).toBe("2024-02")
    expect((selects[1] as HTMLSelectElement).value).toBe("2024-03")
  })

  it("shows trend range controls on Trend tab in vs Month mode", () => {
    renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    fireEvent.click(screen.getByRole("button", { name: "vs Month" }))
    fireEvent.click(screen.getByRole("button", { name: "Trend" }))

    expect(screen.getByText("Range")).toBeTruthy()
    expect(screen.getByText(/From 2023-10/)).toBeTruthy()
    expect(screen.queryByText("Month A")).toBeNull()
  })

  it("shows error banner when fetch fails", () => {
    mockUseNormalizedTransactions.mockImplementation(() => ({
      isPending: false,
      isError: true,
      isSuccess: false,
      data: undefined,
      refetch: vi.fn(),
    }))

    renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    expect(screen.getByRole("alert")).toBeTruthy()
    expect(screen.getByText("Unable to load transactions")).toBeTruthy()
  })

  it("renders Top-N slider with Budgets shown label", () => {
    renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    expect(screen.getByText("Budgets shown:")).toBeTruthy()
    const slider = screen.getByRole("slider")
    expect(slider.getAttribute("min")).toBe("10")
    expect(slider.getAttribute("max")).toBe("25")
  })

  it("shows variance scope note instead of relying on global date filter", () => {
    renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

    expect(screen.getByTestId("variance-toolbar")).toBeTruthy()
    expect(
      screen.getByText(/global date filter does not apply/i),
    ).toBeTruthy()
  })

  it("shows compare empty copy when no transactions match filter in vs Month mode", () => {
    mockUseNormalizedTransactions.mockImplementation(() => ({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        data: [
          {
            ...mainCheckingWithdrawal,
            date: "2024-03-15",
            amount: "10.00",
          },
        ],
      },
      refetch: vi.fn(),
    }))

    renderVariancePage(
      <MomVarianceReportPage filter={() => false} {...pageProps} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "vs Month" }))

    expect(
      screen.getByTestId("mom-compare-empty").textContent,
    ).toContain("No spending in this date range")
    expect(screen.queryByTestId("mom-variance-table")).toBeNull()
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

    it("navigates to categorize queue when Uncategorized selected on trend chart", () => {
      mockNavigate.mockClear()
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "Trend" }))
      fireEvent.click(screen.getByTestId("trend-uncategorized-trigger"))

      expect(mockNavigate).toHaveBeenCalledWith(
        "/manage/categorize?start=2023-09-01&end=2024-03-15",
      )
      expect(screen.queryByText("Uncategorized breakdown")).toBeNull()
    })

    it("opens category drilldown card when budget selected on Trend tab", () => {
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

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
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByTestId("compare-drill-trigger"))

      expect(screen.getByText("Groceries breakdown")).toBeTruthy()
      expect(screen.getByTestId("mom-compare-chart-embedded")).toBeTruthy()
    })

    it("hides drilldown when Clear is clicked", () => {
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

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
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "Trend" }))
      fireEvent.click(screen.getByTestId("trend-drill-trigger"))
      expect(screen.getByText("Groceries breakdown")).toBeTruthy()

      fireEvent.change(screen.getByRole("slider"), { target: { value: "12" } })

      expect(screen.queryByText("Groceries breakdown")).toBeNull()
    })

    it("preserves selectedBudget when switching tabs while drilled", () => {
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "Trend" }))
      fireEvent.click(screen.getByTestId("trend-drill-trigger"))
      expect(screen.getByTestId("mom-trend-chart-embedded")).toBeTruthy()

      fireEvent.click(screen.getByRole("button", { name: "Compare" }))

      expect(screen.getByText("Groceries breakdown")).toBeTruthy()
      expect(screen.queryByTestId("mom-trend-chart-embedded")).toBeNull()
      expect(screen.getByTestId("mom-compare-chart-embedded")).toBeTruthy()
    })

    it("clears drill when compare mode changes", () => {
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "Trend" }))
      fireEvent.click(screen.getByTestId("trend-drill-trigger"))
      expect(screen.getByText("Groceries breakdown")).toBeTruthy()

      fireEvent.click(screen.getByRole("button", { name: "vs Month" }))

      expect(screen.queryByText("Groceries breakdown")).toBeNull()
    })

    it("keeps drill when month pair changes on Compare tab in vs Month mode", () => {
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "vs Month" }))
      fireEvent.click(screen.getByTestId("compare-drill-trigger"))
      expect(screen.getByText("Groceries breakdown")).toBeTruthy()

      const selects = screen.getAllByRole("combobox")
      fireEvent.change(selects[0]!, { target: { value: "2024-01" } })

      expect(screen.getByText("Groceries breakdown")).toBeTruthy()
    })
  })

  describe("data table", () => {
    beforeEach(() => {
      mockUseNormalizedTransactions.mockImplementation(() => ({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: { data: groceriesRows },
        refetch: vi.fn(),
      }))
    })

    it("shows compare budget table beneath the chart", () => {
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      expect(screen.getByTestId("mom-variance-table")).toBeTruthy()
      expect(screen.getByText("Monthly amounts")).toBeTruthy()
      expect(screen.getAllByText("Groceries").length).toBeGreaterThan(0)
    })

    it("shows trend delta table when Trend tab is selected", () => {
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByRole("button", { name: "Trend" }))

      expect(screen.getByTestId("mom-variance-table")).toBeTruthy()
      expect(screen.getByText("Month-over-month change")).toBeTruthy()
    })

    it("shows category table in drilldown card", () => {
      renderVariancePage(<MomVarianceReportPage filter={alwaysTrue} {...pageProps} />)

      fireEvent.click(screen.getByTestId("compare-drill-trigger"))

      expect(screen.getByTestId("mom-variance-table-embedded")).toBeTruthy()
      expect(screen.getByText("Food")).toBeTruthy()
    })
  })
})
