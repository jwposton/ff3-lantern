import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isCashMovementRow } from "@/lib/sankey"
import { mainCheckingWithdrawal, salaryDeposit } from "@/test/fixtures/omniRows"
import type { OmniRow } from "@/types/NormalizedTransaction"

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

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

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
    interactionHint,
    onNodeClick,
    headerActions,
  }: {
    emptyMessage: string
    loading?: boolean
    data: { nodes: unknown[] }
    chartTitle?: string
    interactionHint?: string
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
        data-has-node-click={onNodeClick ? "true" : "false"}
        data-interaction-hint={interactionHint}
        onClick={() => onNodeClick?.("Essentials_BUDGET")}
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

  it("includes deposits in sankey population", () => {
    expect(isCashMovementRow(salaryDeposit)).toBe(true)
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

  it("wires node click handler for drilldown", () => {
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
    ).toBe("true")
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

    render(<CashFlowSankeyPage />)

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

  it("interaction hint mentions node drilldown", () => {
    const rows = [mainCheckingWithdrawal]
    mockUseNormalizedTransactions.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: rows },
      refetch: vi.fn(),
    })

    render(<CashFlowSankeyPage />)

    const hint = screen
      .getByTestId("sankey-chart")
      .getAttribute("data-interaction-hint")
    expect(hint?.toLowerCase()).toMatch(/drill|node/)
  })

  it("passes drilldownMode cashflow and aggregateBanks to SankeyReportPage", () => {
    render(<CashFlowSankeyPage />)

    expect(mockSankeyReportPageProps).toHaveBeenCalled()
    const props = mockSankeyReportPageProps.mock.calls[0][0]
    expect(props.enableDrilldown).toBe(true)
    expect(props.drilldownMode).toBe("cashflow")
    expect(typeof props.aggregateBanks).toBe("boolean")
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
