import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isCashMovementRow } from "@/lib/sankey"
import { mainCheckingWithdrawal } from "@/test/fixtures/omniRows"
import type { OmniRow } from "@/types/NormalizedTransaction"

const mockUseDateRange = vi.fn()
const mockUseNormalizedTransactions = vi.fn()

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
    onNodeClick,
  }: {
    emptyMessage: string
    loading?: boolean
    data: { nodes: unknown[] }
    onNodeClick?: (nodeName: string) => void
  }) => {
    if (loading) {
      return <div data-testid="chart-loading" />
    }
    const hasData = data.nodes.length > 0
    return hasData ? (
      <div
        data-testid="sankey-chart"
        data-has-node-click={onNodeClick ? "true" : "false"}
      />
    ) : (
      <div data-testid="empty-message">{emptyMessage}</div>
    )
  },
}))

import { CashFlowSankeyPage } from "./CashFlowSankeyPage"

describe("CashFlowSankeyPage", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
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

  it("renders page title Cash Flow and aggregate label", () => {
    render(<CashFlowSankeyPage />)

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Cash Flow",
    )
    expect(screen.getByLabelText("Aggregate bank accounts")).toBeTruthy()
  })

  it("uses isCashMovementRow filter and cash movement empty copy", () => {
    render(<CashFlowSankeyPage />)

    expect(screen.getByTestId("empty-message").textContent).toBe(
      "No cash movement in this date range",
    )
  })

  it("renders chart for cash movement rows", () => {
    const rows = [mainCheckingWithdrawal]
    expect(rows.filter(isCashMovementRow).length).toBeGreaterThan(0)

    mockUseNormalizedTransactions.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: rows },
      refetch: vi.fn(),
    })

    render(<CashFlowSankeyPage />)

    expect(screen.getByTestId("sankey-chart")).toBeTruthy()
    expect(screen.queryByTestId("empty-message")).toBeNull()
  })

  it("does not wire node click handler (no drilldown)", () => {
    const rows = [mainCheckingWithdrawal]
    mockUseNormalizedTransactions.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: rows },
      refetch: vi.fn(),
    })

    render(<CashFlowSankeyPage />)

    expect(
      screen.getByTestId("sankey-chart").getAttribute("data-has-node-click"),
    ).toBe("false")
  })

  it("shows bank bucketing helper when many banks and aggregate unchecked", () => {
    const rows: OmniRow[] = []
    for (let i = 0; i < 12; i++) {
      rows.push({
        amount: String(100 - i),
        type: "withdrawal",
        source_account: `Bank ${i}`,
        source_type: "Asset account",
        source_role: "Default account",
        destination_account: "Store",
        destination_type: "Expense account",
        destination_role: null,
        budget: "Essentials",
        category: "Food",
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      })
    }

    mockUseNormalizedTransactions.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: rows },
      refetch: vi.fn(),
    })

    render(<CashFlowSankeyPage />)

    const checkbox = screen.getByLabelText(
      "Aggregate bank accounts",
    ) as HTMLInputElement
    checkbox.click()

    expect(
      screen.getByText(
        /Showing top 8 bank accounts by flow; others grouped as Other Banks/,
      ),
    ).toBeTruthy()
  })
})
