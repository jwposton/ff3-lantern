import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { isCashFlowOutflow } from "@/lib/spending"
import {
  creditCardPaymentTransfer,
  mainCheckingWithdrawal,
  savingsTransfer,
} from "@/test/fixtures/omniRows"

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
    chartData,
  }: {
    emptyMessage: string
    loading: boolean
    chartData: { stacks: string[] }
    onSelect: (budget: string) => void
  }) => {
    if (loading) {
      return <div data-testid="chart-loading" />
    }
    const hasData = chartData.stacks.length > 0
    return hasData ? (
      <div data-testid="chart-has-data" />
    ) : (
      <div data-testid="empty-message">{emptyMessage}</div>
    )
  },
}))

vi.mock("@/components/BudgetReportDrilldown", () => ({
  BudgetReportDrilldown: () => null,
}))

import { CashFlowBarPage } from "./CashFlowBarPage"

describe("CashFlowBarPage", () => {
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

  it("uses isCashFlowOutflow filter and cash outflow copy", () => {
    render(
      <MemoryRouter>
        <CashFlowBarPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Cash Flow",
    )
    expect(screen.getByTestId("empty-message").textContent).toBe(
      "No cash outflow in this date range",
    )
  })

  it("shows chart data for cash-outflow rows", () => {
    const rows = [
      mainCheckingWithdrawal,
      creditCardPaymentTransfer,
      savingsTransfer,
    ]
    expect(rows.filter(isCashFlowOutflow).length).toBeGreaterThan(0)

    mockUseNormalizedTransactions.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { data: rows },
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter>
        <CashFlowBarPage />
      </MemoryRouter>,
    )

    expect(screen.getByTestId("chart-has-data")).toBeTruthy()
    expect(screen.queryByTestId("empty-message")).toBeNull()
  })
})
