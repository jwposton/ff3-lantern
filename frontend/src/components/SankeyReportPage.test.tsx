import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { isSpendingExpense } from "@/lib/spending"
import { buildSpendingSankeyData } from "@/lib/sankey"
import { creditCardWithdrawal, mainCheckingWithdrawal } from "@/test/fixtures/omniRows"

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

vi.mock("@/components/SankeyChart", () => ({
  SankeyChart: ({
    emptyMessage,
    loading,
    data,
    chartTitle,
    onNodeClick,
    headerActions,
  }: {
    emptyMessage: string
    loading?: boolean
    data: { nodes: { name: string; displayName: string }[] }
    chartTitle?: string
    onNodeClick?: (nodeName: string) => void
    headerActions?: React.ReactNode
  }) => {
    if (loading) {
      return <div data-testid="chart-loading" />
    }
    const hasData = data.nodes.length > 0
    if (chartTitle?.includes("breakdown")) {
      return (
        <div data-testid="drilldown-chart">
          {headerActions}
          <span data-testid="drilldown-title">{chartTitle}</span>
          <button
            type="button"
            data-testid="subchart-uncategorized"
            onClick={() => onNodeClick?.("Uncategorized (C)")}
          >
            Subchart Uncategorized
          </button>
        </div>
      )
    }
    return hasData ? (
      <div data-testid="sankey-chart">
        <button
          type="button"
          data-testid="main-essentials"
          onClick={() => onNodeClick?.("Essentials (B)")}
        >
          Essentials
        </button>
        <button
          type="button"
          data-testid="main-uncategorized"
          onClick={() => onNodeClick?.("Uncategorized (B)")}
        >
          Uncategorized
        </button>
      </div>
    ) : (
      <div data-testid="empty-message">{emptyMessage}</div>
    )
  },
}))

import { SankeyReportPage } from "./SankeyReportPage"

describe("SankeyReportPage Uncategorized navigation", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  beforeEach(() => {
    mockNavigate.mockClear()
    mockUseDateRange.mockReturnValue({
      committedRange: { start: "2024-01-01", end: "2024-01-31" },
    })
  })

  function renderPage(rows = [mainCheckingWithdrawal, creditCardWithdrawal]) {
    mockUseNormalizedTransactions.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        data: rows,
        firefly_base_url: "https://ff.example",
      },
      refetch: vi.fn(),
    })

    return render(
      <MemoryRouter>
        <SankeyReportPage
          filter={isSpendingExpense}
          pageTitle="Spending"
          mainChartTitle="Spending flow"
          interactionHint="Click a node"
          emptyMessage="No spending"
          buildMain={(sliceRows) =>
            buildSpendingSankeyData(sliceRows, "source-budget-category")
          }
          enableDrilldown
        />
      </MemoryRouter>,
    )
  }

  it("navigates to categorize queue when Uncategorized main node clicked", async () => {
    renderPage()

    fireEvent.click(screen.getByTestId("main-uncategorized"))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        "/manage/categorize?start=2024-01-01&end=2024-01-31",
      )
    })
    expect(screen.queryByTestId("drilldown-chart")).toBeNull()
  })

  it("still shows drilldown for non-Uncategorized node", async () => {
    renderPage()

    fireEvent.click(screen.getByTestId("main-essentials"))

    await waitFor(() => {
      expect(screen.getByTestId("drilldown-chart")).toBeTruthy()
    })
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("navigates from subchart Uncategorized instead of Firefly search", async () => {
    const uncategorizedCategoryRow = {
      ...mainCheckingWithdrawal,
      category: "",
    }

    renderPage([uncategorizedCategoryRow])

    fireEvent.click(screen.getByTestId("main-essentials"))
    await waitFor(() => {
      expect(screen.getByTestId("drilldown-chart")).toBeTruthy()
    })

    mockNavigate.mockClear()
    fireEvent.click(screen.getByTestId("subchart-uncategorized"))

    expect(mockNavigate).toHaveBeenCalledWith(
      "/manage/categorize?start=2024-01-01&end=2024-01-31",
    )
  })
})
