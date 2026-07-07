import { describe, expect, it } from "vitest"

import { pathnameUsesGlobalDateRange } from "./globalDateRangeRoutes"

describe("pathnameUsesGlobalDateRange", () => {
  it("shows on dashboard and date-scoped manage/report routes", () => {
    expect(pathnameUsesGlobalDateRange("/")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/reports/transactions")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/manage/categorize")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/manage/loans/queue")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/manage/loans/42")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/reports/spending")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/reports/spending/trends")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/reports/spending/sankey")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/reports/cash-flow")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/reports/cash-flow/trends")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/reports/cash-flow/sankey")).toBe(true)
  })

  it("hides on payment worksheet, variance, loans list, and about", () => {
    expect(pathnameUsesGlobalDateRange("/manage/payment-run")).toBe(false)
    expect(pathnameUsesGlobalDateRange("/manage/payment-run/setup")).toBe(false)
    expect(pathnameUsesGlobalDateRange("/manage/bills")).toBe(false)
    expect(pathnameUsesGlobalDateRange("/manage/bills/42")).toBe(false)
    expect(pathnameUsesGlobalDateRange("/manage/loans")).toBe(false)
    expect(pathnameUsesGlobalDateRange("/reports/spending/mom")).toBe(false)
    expect(pathnameUsesGlobalDateRange("/reports/cash-flow/mom")).toBe(false)
    expect(pathnameUsesGlobalDateRange("/about")).toBe(false)
  })

  it("shows on credit card and liability analytics routes", () => {
    expect(pathnameUsesGlobalDateRange("/manage/payment-run/cards")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/manage/payment-run/cards/3")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/manage/liabilities")).toBe(true)
    expect(pathnameUsesGlobalDateRange("/manage/liabilities/42")).toBe(true)
  })
})
