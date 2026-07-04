import { describe, expect, it } from "vitest"

import {
  buildCategorizeExplorerPath,
  buildExplorerPathFromPendingRow,
  buildExplorerPathFromRuleDraft,
  buildTransactionExplorerPath,
  parseExplorerFiltersFromSearchParams,
} from "./explorerFilterUrl"

describe("explorerFilterUrl", () => {
  it("buildCategorizeExplorerPath sets categorize_queue preset", () => {
    expect(buildCategorizeExplorerPath("2024-01-01", "2024-01-31")).toBe(
      "/reports/transactions?start=2024-01-01&end=2024-01-31&categorize_queue=1",
    )
  })

  it("buildTransactionExplorerPath encodes filter params", () => {
    const path = buildTransactionExplorerPath("2024-01-01", "2024-01-31", {
      transaction_type: "withdrawal",
      amount_exact: "5.62",
      uncategorized_only: true,
    })
    expect(path).toContain("type=withdrawal")
    expect(path).toContain("amount=5.62")
    expect(path).toContain("uncategorized_only=1")
    expect(path).not.toContain("show_all_types")
  })

  it("parseExplorerFiltersFromSearchParams round-trips categorize preset", () => {
    const params = new URLSearchParams(
      "start=2024-01-01&end=2024-01-31&categorize_queue=1&type=withdrawal&amount=5.62",
    )
    const parsed = parseExplorerFiltersFromSearchParams(params)
    expect(parsed.fromUrl).toBe(true)
    expect(parsed.filters.categorize_queue_only).toBe(true)
    expect(parsed.filters.transaction_type).toBe("withdrawal")
    expect(parsed.filters.amount_exact).toBe("5.62")
    expect(parsed.showAllTypes).toBe(true)
  })

  it("parseExplorerFiltersFromSearchParams defaults showAllTypes true without URL param", () => {
    const parsed = parseExplorerFiltersFromSearchParams(
      new URLSearchParams("start=2024-01-01&end=2024-01-31"),
    )
    expect(parsed.showAllTypes).toBe(true)
    expect(parsed.fromUrl).toBe(false)
  })

  it("parseExplorerFiltersFromSearchParams respects show_all_types=0", () => {
    const parsed = parseExplorerFiltersFromSearchParams(
      new URLSearchParams("show_all_types=0"),
    )
    expect(parsed.showAllTypes).toBe(false)
    expect(parsed.fromUrl).toBe(true)
  })

  it("buildTransactionExplorerPath encodes bank-only scope", () => {
    const path = buildTransactionExplorerPath(
      "2024-01-01",
      "2024-01-31",
      undefined,
      { showAllTypes: false },
    )
    expect(path).toContain("show_all_types=0")
  })

  it("buildExplorerPathFromPendingRow encodes description and destination", () => {
    const path = buildExplorerPathFromPendingRow("2024-01-01", "2024-01-31", {
      description: "AMZN MKTP",
      destination_name: "Amazon",
      type: "withdrawal",
    })
    expect(path).toContain("description=AMZN+MKTP")
    expect(path).toContain("destination=Amazon")
    expect(path).toContain("dest_match=is")
    expect(path).toContain("type=withdrawal")
    expect(path).not.toContain("show_all_types")
  })

  it("buildExplorerPathFromRuleDraft encodes rule triggers", () => {
    const path = buildExplorerPathFromRuleDraft("2024-01-01", "2024-01-31", {
      description_contains: "AMZN",
      destination_account: "Amazon",
      destination_match_type: "is",
      transaction_type: "withdrawal",
      amount: "-42.00",
    })
    expect(path).toContain("description=AMZN")
    expect(path).toContain("destination=Amazon")
    expect(path).toContain("amount=42.00")
    expect(path).not.toContain("show_all_types")
  })

  it("buildTransactionExplorerPath encodes amount range params", () => {
    const path = buildTransactionExplorerPath("2024-01-01", "2024-01-31", {
      amount_min: "50",
      amount_max: "100",
    })
    expect(path).toContain("amount_min=50")
    expect(path).toContain("amount_max=100")
  })
})
