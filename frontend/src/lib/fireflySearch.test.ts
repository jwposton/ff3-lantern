import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildDateRangeFilters,
  buildDrilldownFireflySearch,
  buildFireflyFilters,
  CC_PAYMENT_BUDGET_LABEL,
  getCashFlowNodeQueryString,
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

  it('returns empty string for Other (C) node', () => {
    expect(getSpendingNodeQueryString("Other (C)", "Other")).toBe("")
  })

  it("escapes embedded double quotes in account_is filter", () => {
    expect(getSpendingNodeQueryString('My "Special" (A)', 'My "Special"')).toBe(
      'account_is:"My \\"Special\\""',
    )
  })

  it("omits category_is:Other when edge targets Other (C)", () => {
    const result = buildFireflyFilters(
      buildDateRangeFilters("2024-01-01", "2024-01-31"),
      "Essentials (B)",
      "Other (C)",
      { "Essentials (B)": "Essentials", "Other (C)": "Other" },
    )
    expect(result).toContain('budget_is:"Essentials"')
    expect(result).not.toContain("category_is")
    expect(result).not.toContain("Other")
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

  it("maps Cash Flow deposit source→bank edge without type:withdrawal", () => {
    const result = buildFireflyFilters(
      buildDateRangeFilters("2024-01-01", "2024-01-31"),
      "Paycheck_SRC",
      "Main Checking_BANK",
      {
        Paycheck_SRC: "Paycheck",
        "Main Checking_BANK": "Main Checking",
      },
    )
    expect(result).toContain('account_is:"Paycheck"')
    expect(result).toContain('account_is:"Main Checking"')
    expect(result).not.toContain("type:withdrawal")
  })

  it("maps Cash Flow Essentials_BUDGET to budget_is filter", () => {
    expect(
      getCashFlowNodeQueryString("Essentials_BUDGET", "Essentials"),
    ).toBe('budget_is:"Essentials"')
  })

  it("maps Cash Flow Food_CAT to category_is filter", () => {
    expect(getCashFlowNodeQueryString("Food_CAT", "Food")).toBe(
      'category_is:"Food"',
    )
  })

  it("maps Cash Flow Main Checking_BANK to account_is filter", () => {
    expect(
      getCashFlowNodeQueryString("Main Checking_BANK", "Main Checking"),
    ).toBe('account_is:"Main Checking"')
  })

  it("returns empty string for aggregated BankAccounts_BANK node", () => {
    expect(
      getCashFlowNodeQueryString("BankAccounts_BANK", "Bank Accounts"),
    ).toBe("")
  })

  it("maps Cash Flow Uncategorized budget to has_any_budget:false", () => {
    expect(
      getCashFlowNodeQueryString("Uncategorized_BUDGET", "Uncategorized"),
    ).toBe("has_any_budget:false")
  })

  it("maps Cash Flow Paycheck_SRC to account_is filter", () => {
    expect(getCashFlowNodeQueryString("Paycheck_SRC", "Paycheck")).toBe(
      'account_is:"Paycheck"',
    )
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

describe("buildDrilldownFireflySearch", () => {
  it("spending: budget-only scope includes date range and budget filter", () => {
    const result = buildDrilldownFireflySearch("2024-01-01", "2024-01-31", {
      budget: "Essentials",
      useCashFlowLabels: false,
    })
    expect(result).toContain("date_after:2024-01-01")
    expect(result).toContain("date_before:2024-01-31")
    expect(result).toContain('budget_is:"Essentials"')
  })

  it("spending: full drilldown stacks budget, category, and payee filters", () => {
    const result = buildDrilldownFireflySearch("2024-01-01", "2024-01-31", {
      budget: "Essentials",
      category: "Food",
      payee: "Grocery Store",
      useCashFlowLabels: false,
    })
    expect(result).toContain('budget_is:"Essentials"')
    expect(result).toContain('category_is:"Food"')
    expect(result).toContain('destination_account_is:"Grocery Store"')
  })

  it("cash flow: CC Payment budget maps to server budget name", () => {
    const result = buildDrilldownFireflySearch("2024-01-01", "2024-01-31", {
      budget: CC_PAYMENT_BUDGET_LABEL,
      useCashFlowLabels: true,
    })
    expect(result).toContain('budget_is:"Credit Card Payment"')
  })

  it("cash flow: CC Payment category uses account_is for card name", () => {
    const result = buildDrilldownFireflySearch("2024-01-01", "2024-01-31", {
      budget: CC_PAYMENT_BUDGET_LABEL,
      category: "Chase VISA",
      useCashFlowLabels: true,
    })
    expect(result).toContain('budget_is:"Credit Card Payment"')
    expect(result).toContain('account_is:"Chase VISA"')
  })
})
