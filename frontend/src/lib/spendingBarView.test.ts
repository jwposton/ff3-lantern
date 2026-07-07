import { describe, expect, it } from "vitest"

import {
  parseSpendingBarViewMode,
  spendingBarViewSearchParam,
} from "@/lib/spendingBarView"

describe("spendingBarView", () => {
  it("defaults invalid or missing view to combined", () => {
    expect(parseSpendingBarViewMode(null)).toBe("combined")
    expect(parseSpendingBarViewMode("")).toBe("combined")
    expect(parseSpendingBarViewMode("other")).toBe("combined")
  })

  it("parses split view", () => {
    expect(parseSpendingBarViewMode("split")).toBe("split")
    expect(parseSpendingBarViewMode("combined")).toBe("combined")
  })

  it("omits combined from URL params", () => {
    expect(spendingBarViewSearchParam("combined")).toBeNull()
    expect(spendingBarViewSearchParam("split")).toBe("split")
  })
})
