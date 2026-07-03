import { describe, expect, it } from "vitest"

import {
  buildCategorizeExplorerPath,
  buildExplorerPathFromPendingRow,
  buildExplorerPathFromRuleDraft,
  buildTransactionExplorerPath,
  extractBroadSearchTerm,
  parseAmountClauses,
  tryDeterministicExplorerQuery,
  normalizeAiParsedFilter,
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

  it("normalizeAiParsedFilter maps description_contains to search for broad queries", () => {
    const normalized = normalizeAiParsedFilter(
      { description_contains: "spotify" },
      "spotify charges",
    )
    expect(normalized.search).toBe("spotify")
    expect(normalized.description_contains).toBe("")
  })

  it("extractBroadSearchTerm strips natural-language phrasing", () => {
    expect(extractBroadSearchTerm("all transactions with spotify")).toBe("spotify")
    expect(extractBroadSearchTerm("spotify charges")).toBe("spotify")
  })

  it("tryDeterministicExplorerQuery parses OR keywords with amount", () => {
    const parsed = tryDeterministicExplorerQuery(
      "Spotify or CFBD or Patreon or amount is 700",
    )
    expect(parsed).toEqual({
      search: "Spotify or CFBD or Patreon",
      amount_exact: "700.00",
      amount_min: "",
      amount_max: "",
    })
  })

  it("tryDeterministicExplorerQuery parses leading amount with OR keywords", () => {
    const parsed = tryDeterministicExplorerQuery("700 and CFBD or patreon charges")
    expect(parsed).toEqual({
      search: "CFBD or patreon",
      amount_exact: "700.00",
      amount_min: "",
      amount_max: "",
    })
  })

  it("normalizeAiParsedFilter uses deterministic composite parsing", () => {
    const normalized = normalizeAiParsedFilter(
      { description_contains: "wrong" },
      "700 and CFBD or patreon charges",
    )
    expect(normalized.search).toBe("CFBD or patreon")
    expect(normalized.amount_exact).toBe("700.00")
    expect(normalized.description_contains).toBe("")
  })

  it("parseAmountClauses parses over and between ranges", () => {
    expect(parseAmountClauses("over 500")).toEqual({
      amounts: {
        amount_exact: "",
        amount_min: "500.00",
        amount_max: "",
      },
      remainder: "",
    })
    expect(parseAmountClauses("between 50 and 100")).toEqual({
      amounts: {
        amount_exact: "",
        amount_min: "50.00",
        amount_max: "100.00",
      },
      remainder: "",
    })
    expect(parseAmountClauses("amount between 100 and 200")).toEqual({
      amounts: {
        amount_exact: "",
        amount_min: "100.00",
        amount_max: "200.00",
      },
      remainder: "",
    })
    expect(parseAmountClauses("value between 50 and 100")).toEqual({
      amounts: {
        amount_exact: "",
        amount_min: "50.00",
        amount_max: "100.00",
      },
      remainder: "",
    })
  })

  it("tryDeterministicExplorerQuery does not leave amount as search", () => {
    const parsed = tryDeterministicExplorerQuery("amount between 100 and 200")
    expect(parsed?.search).toBe("")
    expect(parsed?.amount_min).toBe("100.00")
    expect(parsed?.amount_max).toBe("200.00")
  })

  it("normalizeAiParsedFilter clears amount keyword when range is set", () => {
    const normalized = normalizeAiParsedFilter(
      {
        search: "amount",
        amount_min: "100.00",
        amount_max: "200.00",
      },
      "amount between 100 and 200",
    )
    expect(normalized.search).toBe("")
    expect(normalized.amount_min).toBe("100.00")
  })

  it("tryDeterministicExplorerQuery parses range with OR keywords", () => {
    const parsed = tryDeterministicExplorerQuery("spotify or patreon under 20")
    expect(parsed).toEqual({
      search: "spotify or patreon",
      amount_exact: "",
      amount_min: "",
      amount_max: "20.00",
    })
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
