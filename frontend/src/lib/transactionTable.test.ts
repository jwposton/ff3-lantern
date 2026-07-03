import { describe, expect, it } from "vitest"

import {
  creditCardWithdrawal,
  mainCheckingWithdrawal,
  transportWithdrawal,
  uncategorizedWithdrawal,
} from "@/test/fixtures/omniRows"
import type { OmniRow } from "@/types/NormalizedTransaction"

import {
  EMPTY_FILTERS,
  PAGE_SIZE,
  applyDefaultTypeScope,
  applyFilters,
  distinctCategories,
  distinctSourceAccounts,
  hasActiveFilters,
  paginateRows,
  sortRows,
} from "./transactionTable"

const depositRow: OmniRow = {
  amount: "500",
  type: "deposit",
  source_account: "Employer",
  source_type: "Revenue account",
  source_role: null,
  destination_account: "Main Checking",
  destination_type: "Asset account",
  destination_role: "Default account",
  budget: null,
  category: null,
  date: "2024-01-10",
}

describe("transactionTable", () => {
  it("PAGE_SIZE is 50", () => {
    expect(PAGE_SIZE).toBe(50)
  })

  it("applyDefaultTypeScope excludes deposit when showAllTypes false", () => {
    const rows = [mainCheckingWithdrawal, depositRow, creditCardWithdrawal]
    const scoped = applyDefaultTypeScope(rows, false)
    expect(scoped).toEqual([mainCheckingWithdrawal])
  })

  it("sortRows sorts date descending by default direction", () => {
    const rows = [mainCheckingWithdrawal, transportWithdrawal]
    const sorted = sortRows(rows, "date", "desc")
    expect(sorted[0].date).toBe("2024-01-17")
    expect(sorted[1].date).toBe("2024-01-15")
  })

  it("sortRows toggles amount ascending", () => {
    const rows = [transportWithdrawal, mainCheckingWithdrawal]
    const sorted = sortRows(rows, "amount", "asc")
    expect(parseFloat(sorted[0].amount!)).toBeLessThan(
      parseFloat(sorted[1].amount!),
    )
  })

  it("applyFilters uses OR logic for categories", () => {
    const rows = [mainCheckingWithdrawal, transportWithdrawal, creditCardWithdrawal]
    const filtered = applyFilters(rows, {
      ...EMPTY_FILTERS,
      categories: ["Food", "Transport"],
    })
    expect(filtered).toEqual([mainCheckingWithdrawal, transportWithdrawal])
  })

  it("applyFilters search matches source account name", () => {
    const rows = [mainCheckingWithdrawal, transportWithdrawal]
    const filtered = applyFilters(rows, {
      ...EMPTY_FILTERS,
      search: "grocery",
    })
    expect(filtered).toEqual([mainCheckingWithdrawal])
  })

  it("applyFilters description_contains matches description field", () => {
    const rows = [
      { ...mainCheckingWithdrawal, description: "AMZN MKTP US" },
      { ...transportWithdrawal, description: "Shell Gas" },
    ]
    const filtered = applyFilters(rows, {
      ...EMPTY_FILTERS,
      description_contains: "amzn",
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].description).toContain("AMZN")
  })

  it("applyFilters uncategorized_only excludes categorized rows", () => {
    const rows = [mainCheckingWithdrawal, uncategorizedWithdrawal]
    const filtered = applyFilters(rows, {
      ...EMPTY_FILTERS,
      uncategorized_only: true,
    })
    expect(filtered).toEqual([uncategorizedWithdrawal])
  })

  it("hasActiveFilters is false for empty filters", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(
      hasActiveFilters({ ...EMPTY_FILTERS, categories: ["Food"] }),
    ).toBe(true)
  })

  it("distinctCategories returns sorted unique values", () => {
    const rows = [mainCheckingWithdrawal, transportWithdrawal, creditCardWithdrawal]
    expect(distinctCategories(rows)).toEqual(["Food", "Shopping", "Transport"])
  })

  it("distinctSourceAccounts returns sorted unique values", () => {
    const rows = [mainCheckingWithdrawal, creditCardWithdrawal]
    expect(distinctSourceAccounts(rows)).toEqual(["Chase VISA", "Main Checking"])
  })

  it("paginateRows returns slice and totalPages", () => {
    const many = Array.from({ length: 55 }, (_, i) => ({
      ...mainCheckingWithdrawal,
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    }))
    const { pageRows, totalPages } = paginateRows(many, 0)
    expect(pageRows).toHaveLength(50)
    expect(totalPages).toBe(2)
    const page2 = paginateRows(many, 1)
    expect(page2.pageRows).toHaveLength(5)
  })
})
