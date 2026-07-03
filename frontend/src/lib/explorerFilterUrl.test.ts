import { describe, expect, it } from "vitest"

import {
  buildCategorizeExplorerPath,
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
  })
})
