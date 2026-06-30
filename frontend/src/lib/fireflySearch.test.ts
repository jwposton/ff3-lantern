import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildDateRangeFilters,
  buildFireflyFilters,
  getSpendingNodeQueryString,
  openFireflySearch,
} from "@/lib/fireflySearch"

describe("firefly:", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("maps category node Groceries (C) to category_is filter", () => {
    expect(getSpendingNodeQueryString("Groceries (C)", "Groceries")).toBe(
      'category_is:"Groceries"',
    )
  })

  it("maps Uncategorized (B) to has_any_budget:false", () => {
    expect(getSpendingNodeQueryString("Uncategorized (B)", "Uncategorized")).toBe(
      "has_any_budget:false",
    )
  })

  it("includes date_after and date_before from buildDateRangeFilters in buildFireflyFilters", () => {
    const base = buildDateRangeFilters("2024-01-01", "2024-01-31")
    const result = buildFireflyFilters(
      base,
      "Essentials (B)",
      "Food (C)",
      { "Essentials (B)": "Essentials", "Food (C)": "Food" },
    )
    expect(result).toContain("date_after:2024-01-01")
    expect(result).toContain("date_before:2024-01-31")
    expect(result).toContain('budget_is:"Essentials"')
    expect(result).toContain('category_is:"Food"')
  })

  it("maps Cash Flow BankAccounts_BANK → budget edge to budget filter", () => {
    const result = buildFireflyFilters(
      [],
      "BankAccounts_BANK",
      "Essentials_BUDGET",
      {
        BankAccounts_BANK: "Bank Accounts",
        Essentials_BUDGET: "Essentials",
      },
    )
    expect(result).toContain('budget_is:"Essentials"')
    expect(result.length).toBeGreaterThan(0)
  })

  it("opens Firefly search with encodeURIComponent and noopener,noreferrer", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null)
    openFireflySearch("https://firefly.example/", 'budget_is:"Food"')
    expect(openSpy).toHaveBeenCalledWith(
      'https://firefly.example/search?search=budget_is%3A%22Food%22',
      "_blank",
      "noopener,noreferrer",
    )
  })
})
