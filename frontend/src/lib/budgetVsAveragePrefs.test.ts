import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_BUDGET_VS_AVERAGE_DISPLAY_MODE,
  DEFAULT_BUDGET_VS_AVERAGE_RANK_MODE,
  readBudgetVsAverageDisplayMode,
  readBudgetVsAverageRankMode,
  writeBudgetVsAverageDisplayMode,
  writeBudgetVsAverageRankMode,
} from "@/lib/budgetVsAveragePrefs"

describe("budgetVsAveragePrefs", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("defaults rank mode to change vs average", () => {
    expect(readBudgetVsAverageRankMode()).toBe(DEFAULT_BUDGET_VS_AVERAGE_RANK_MODE)
    expect(DEFAULT_BUDGET_VS_AVERAGE_RANK_MODE).toBe("change-vs-average")
  })

  it("defaults display mode to dollars", () => {
    expect(readBudgetVsAverageDisplayMode()).toBe(
      DEFAULT_BUDGET_VS_AVERAGE_DISPLAY_MODE,
    )
    expect(DEFAULT_BUDGET_VS_AVERAGE_DISPLAY_MODE).toBe("dollars")
  })

  it("persists rank and display modes", () => {
    writeBudgetVsAverageRankMode("total-spend")
    writeBudgetVsAverageDisplayMode("percent-of-average")
    expect(readBudgetVsAverageRankMode()).toBe("total-spend")
    expect(readBudgetVsAverageDisplayMode()).toBe("percent-of-average")
  })
})
