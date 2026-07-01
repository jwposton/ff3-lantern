import { describe, expect, it } from "vitest"

import {
  budgetVsAverageTileTitle,
  cashFlowByBudgetTileTitle,
  formatCalendarMonthLabel,
  formatDashboardDateRange,
  monthlyCashFlowTileSubtitle,
  monthlyCashFlowTileTitle,
  spendingByBudgetTileTitle,
} from "@/lib/dashboardTileLabels"

describe("formatDashboardDateRange", () => {
  it("formats a full calendar month as month and year", () => {
    expect(formatDashboardDateRange("2024-01-01", "2024-01-31")).toBe("January 2024")
  })

  it("formats a partial month within one month", () => {
    expect(formatDashboardDateRange("2024-06-01", "2024-06-15")).toBe(
      "Jun 1 – Jun 15, 2024",
    )
  })

  it("formats a multi-month range in the same year", () => {
    expect(formatDashboardDateRange("2024-01-01", "2024-06-30")).toBe(
      "Jan 1 – Jun 30, 2024",
    )
  })

  it("formats a range spanning years", () => {
    expect(formatDashboardDateRange("2024-12-01", "2025-01-15")).toBe(
      "Dec 1, 2024 – Jan 15, 2025",
    )
  })

  it("formats a single day", () => {
    expect(formatDashboardDateRange("2024-03-05", "2024-03-05")).toBe("Mar 5, 2024")
  })
})

describe("dashboard tile titles", () => {
  it("builds separate titles and subtitles", () => {
    expect(monthlyCashFlowTileTitle()).toBe("Monthly cash flow")
    expect(monthlyCashFlowTileSubtitle("2026-07")).toBe("July 2026")
    expect(spendingByBudgetTileTitle()).toBe("Spending by budget")
    expect(cashFlowByBudgetTileTitle()).toBe("Cash flow by budget")
    expect(budgetVsAverageTileTitle()).toBe("Budget vs 12-month average")
    expect(formatCalendarMonthLabel("2026-07")).toBe("July 2026")
  })
})
