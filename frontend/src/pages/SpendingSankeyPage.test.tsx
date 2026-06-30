import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isSpendingExpense } from "@/lib/spending"
import { mainCheckingWithdrawal } from "@/test/fixtures/omniRows"

const mockUseDateRange = vi.fn()
const mockUseNormalizedTransactions = vi.fn()
const mockSankeyReportPageProps = vi.fn()

vi.mock("@/context/DateRangeContext", () => ({
  useDateRange: () => mockUseDateRange(),
}))

vi.mock("@/hooks/useNormalizedTransactions", () => ({
  useNormalizedTransactions: (...args: unknown[]) =>
    mockUseNormalizedTransactions(...args),
}))

vi.mock("@/components/SankeyReportPage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/SankeyReportPage")>()
  return {
    ...actual,
    SankeyReportPage: (props: Parameters<typeof actual.SankeyReportPage>[0]) => {
      mockSankeyReportPageProps(props)
      return actual.SankeyReportPage(props)
    },
  }
})

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
    data: { nodes: unknown[] }
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
          {!hasData && <div data-testid="drilldown-empty">{emptyMessage}</div>}
        </div>
      )
    }
    return hasData ? (
      <div
        data-testid="sankey-chart"
        onClick={() => onNodeClick?.("Essentials (B)")}
      />
    ) : (
      <div data-testid="empty-message">{emptyMessage}</div>
    )
  },
}))

import { SpendingSankeyPage } from "./SpendingSankeyPage"

describe("SpendingSankeyPage", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mockSankeyReportPageProps.mockClear()
    mockUseDateRange.mockReturnValue({
      committedRange: { start: "2024-01-01", end: "2024-01-31" },
    })
    mockUseNormalizedTransactions.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: [] },
      refetch: vi.fn(),
    })
  })

  it("uses isSpendingExpense filter and spending empty copy", () => {
    render(<SpendingSankeyPage />)

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Spending",
    )
    expect(screen.getByTestId("empty-message").textContent).toBe(
      "No spending in this date range",
    )
  })

  it("renders chart for spending expense rows", () => {
    const rows = [mainCheckingWithdrawal]
    expect(rows.filter(isSpendingExpense).length).toBeGreaterThan(0)

    mockUseNormalizedTransactions.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: rows },
      refetch: vi.fn(),
    })

    render(<SpendingSankeyPage />)

    expect(screen.getByTestId("sankey-chart")).toBeTruthy()
    expect(screen.queryByTestId("empty-message")).toBeNull()
  })

  it("shows drilldown card when a budget node is clicked", async () => {
    const rows = [mainCheckingWithdrawal]
    mockUseNormalizedTransactions.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: rows },
      refetch: vi.fn(),
    })

    render(<SpendingSankeyPage />)

    fireEvent.click(screen.getByTestId("sankey-chart"))

    await waitFor(() => {
      expect(screen.getByTestId("drilldown-chart")).toBeTruthy()
    })
    expect(screen.getByTestId("drilldown-title").textContent).toBe(
      "Essentials breakdown",
    )
    expect(
      screen.getByRole("button", { name: "Clear sankey drilldown" }),
    ).toBeTruthy()
  })

  it("renders Top-N categories shown control", () => {
    render(<SpendingSankeyPage />)

    expect(screen.getByText("Categories shown:")).toBeTruthy()
    expect(screen.getByRole("slider").getAttribute("min")).toBe("5")
    expect(screen.getByRole("slider").getAttribute("max")).toBe("25")
  })

  it("passes topN to SankeyReportPage for Other (C) drilldown", () => {
    render(<SpendingSankeyPage />)

    expect(mockSankeyReportPageProps).toHaveBeenCalled()
    const props = mockSankeyReportPageProps.mock.calls[0][0]
    expect(props.topN).toBeGreaterThanOrEqual(5)
    expect(props.topN).toBeLessThanOrEqual(25)
  })
})
