import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isCashFlowOutflow } from "@/lib/spending"

const mockMomVarianceReportPage = vi.fn()

vi.mock("@/components/MomVarianceReportPage", () => ({
  MomVarianceReportPage: (props: Record<string, unknown>) => {
    mockMomVarianceReportPage(props)
    return <div data-testid="mom-variance-report-page" />
  },
}))

import { CashFlowMomPage } from "./CashFlowMomPage"

describe("CashFlowMomPage", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mockMomVarianceReportPage.mockClear()
  })

  it("passes isCashFlowOutflow filter, useCashFlowLabels, and cash flow copy to MomVarianceReportPage", () => {
    render(<CashFlowMomPage />)

    expect(screen.getByTestId("mom-variance-report-page")).toBeTruthy()

    const props = mockMomVarianceReportPage.mock.calls[0]?.[0] as {
      filter: (row: unknown) => boolean
      useCashFlowLabels: boolean
      pageTitle: string
      emptyMessage: string
      momTopNFamily: string
      trendChartTitle: string
    }

    expect(props.pageTitle).toBe("Cash Flow")
    expect(props.emptyMessage).toBe("No cash outflow in this date range")
    expect(props.momTopNFamily).toBe("cash-flow")
    expect(props.trendChartTitle).toBe("MoM cash outflow change")
    expect(props.useCashFlowLabels).toBe(true)
    expect(props.filter).toBe(isCashFlowOutflow)
  })
})

describe("routes", () => {
  it("registers reports/cash-flow/mom to CashFlowMomPage", async () => {
    const { router } = await import("@/routes")
    const cashFlowMomRoute = router.routes[0]?.children?.find(
      (route) => route.path === "reports/cash-flow/mom",
    )
    expect(cashFlowMomRoute).toBeDefined()
    expect(cashFlowMomRoute?.path).toBe("reports/cash-flow/mom")
  })
})
