import { describe, expect, it } from "vitest"

import type { BarChartData } from "@/lib/barChart"
import {
  buildBudgetVsAverageTileState,
  buildPercentBarChartData,
  budgetVsAverageRankSubtitle,
  budgetVsAverageTileSubtitle,
  dollarsDisplaySortKey,
  noPriorAverageBarPercent,
  percentOfAverage,
  percentOfAverageLabel,
  sortBudgetVsAverageDisplayNames,
} from "@/lib/budgetVsAverageTile"
import { currentVsRollingBaseline } from "@/lib/momVariance"

function makeChartData(
  months: string[],
  stacks: string[],
  data: Record<string, Record<string, number>>,
): BarChartData {
  return { months, stacks, data }
}

describe("percentOfAverage", () => {
  it("returns 100 when current matches baseline", () => {
    expect(percentOfAverage(150, 150)).toBe(100)
  })

  it("returns null when baseline is zero", () => {
    expect(percentOfAverage(50, 0)).toBeNull()
    expect(percentOfAverage(0, 0)).toBeNull()
  })
})

describe("percentOfAverageLabel", () => {
  it("describes undefined ratios when baseline is zero", () => {
    expect(percentOfAverageLabel(0, 0)).toBe(
      "No spending and no prior average",
    )
    expect(percentOfAverageLabel(50, 0)).toBe(
      "No prior average — new spending this month",
    )
  })

  it("formats normal ratios", () => {
    expect(percentOfAverageLabel(150, 100)).toBe("150% of average")
  })
})

describe("noPriorAverageBarPercent", () => {
  it("caps bars at the 100% reference line", () => {
    expect(noPriorAverageBarPercent()).toBe(100)
  })
})

describe("buildPercentBarChartData", () => {
  const values = new Map([
    ["Groceries", { current: 120, baseline: 100 }],
    ["Uncategorized", { current: 882.4, baseline: 0 }],
    ["Other", { current: 0, baseline: 0 }],
  ])

  it("builds ratio, new-spend, and empty datums", () => {
    const data = buildPercentBarChartData(
      ["Groceries", "Uncategorized", "Other"],
      values,
    )
    expect(data[0]).toEqual({ kind: "ratio", percent: 120 })
    expect(data[1]).toMatchObject({
      kind: "no-prior-average",
      barPercent: 100,
      current: 882.4,
    })
    expect(data[2]).toEqual({ kind: "empty" })
  })
})

describe("budgetVsAverageTileSubtitle", () => {
  it("describes total spend ranking", () => {
    expect(budgetVsAverageRankSubtitle("total-spend")).toBe(
      "Top budgets by current or average spend",
    )
    expect(budgetVsAverageTileSubtitle("January 2024", "total-spend")).toBe(
      "January 2024 · Top budgets by current or average spend",
    )
  })

  it("describes change vs average ranking", () => {
    expect(budgetVsAverageRankSubtitle("change-vs-average")).toBe(
      "Largest changes vs 12-month average",
    )
  })
})

describe("sortBudgetVsAverageDisplayNames", () => {
  const values = new Map([
    ["Housing", { current: 2000, baseline: 2000 }],
    ["Food", { current: 400, baseline: 200 }],
    ["CC", { current: 80, baseline: 10 }],
  ])

  it("sorts dollars mode by max(current, 12-mo avg) descending", () => {
    expect(
      sortBudgetVsAverageDisplayNames(
        ["Food", "Housing", "CC"],
        values,
        "dollars",
      ),
    ).toEqual(["Housing", "Food", "CC"])
    const mixed = new Map([
      ["Healthcare", { current: 0, baseline: 1800 }],
      ["Food", { current: 400, baseline: 200 }],
      ["Housing", { current: 2200, baseline: 5100 }],
    ])
    expect(
      sortBudgetVsAverageDisplayNames(
        ["Food", "Healthcare", "Housing"],
        mixed,
        "dollars",
      ),
    ).toEqual(["Housing", "Healthcare", "Food"])
    expect(dollarsDisplaySortKey({ current: 0, baseline: 1800 })).toBe(1800)
  })

  it("sorts percent mode by ratio, with new spend after comparable rows", () => {
    const mixed = new Map([
      ["Housing", { current: 2000, baseline: 2000 }],
      ["Food", { current: 400, baseline: 200 }],
      ["Uncategorized", { current: 882, baseline: 0 }],
    ])
    expect(
      sortBudgetVsAverageDisplayNames(
        ["Housing", "Uncategorized", "Food"],
        mixed,
        "percent-of-average",
      ),
    ).toEqual(["Food", "Housing", "Uncategorized"])
  })
})

describe("buildBudgetVsAverageTileState", () => {
  const chart = makeChartData(
    [
      "2023-02",
      "2023-03",
      "2023-04",
      "2023-05",
      "2023-06",
      "2023-07",
      "2023-08",
      "2023-09",
      "2023-10",
      "2023-11",
      "2023-12",
      "2024-01",
    ],
    ["Housing", "Credit card interest", "Subscriptions"],
    {
      "2023-02": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2023-03": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2023-04": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2023-05": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2023-06": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2023-07": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2023-08": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2023-09": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2023-10": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2023-11": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2023-12": { Housing: 2000, "Credit card interest": 10, Subscriptions: 20 },
      "2024-01": {
        Housing: 2000,
        "Credit card interest": 80,
        Subscriptions: 20,
      },
    },
  )

  const currentMonth = "2024-01"
  const pairs = currentVsRollingBaseline(chart, currentMonth, 12, "mean")

  it("ranks by total spend using current month dollars", () => {
    const state = buildBudgetVsAverageTileState(
      chart,
      currentMonth,
      12,
      "mean",
      "total-spend",
      "dollars",
      3,
      pairs,
    )
    expect(state.sortedNames[0]).toBe("Housing")
  })

  it("ranks by change vs average so credit card interest surfaces", () => {
    const state = buildBudgetVsAverageTileState(
      chart,
      currentMonth,
      12,
      "mean",
      "change-vs-average",
      "dollars",
      3,
      pairs,
    )
    expect(state.sortedNames).toContain("Credit card interest")
    expect(state.sortedNames[0]).toBe("Housing")
  })

  it("returns empty state when pairs are null", () => {
    const state = buildBudgetVsAverageTileState(
      chart,
      currentMonth,
      12,
      "mean",
      "change-vs-average",
      "dollars",
      3,
      null,
    )
    expect(state.sortedNames).toEqual([])
    expect(state.values.size).toBe(0)
  })

  it("includes zero-current budgets in total spend when average is high", () => {
    const chart = makeChartData(
      ["2023-12", "2024-01"],
      ["Housing", "Healthcare"],
      {
        "2023-12": { Housing: 2000, Healthcare: 1800 },
        "2024-01": { Housing: 2000, Healthcare: 0 },
      },
    )
    const pairs = currentVsRollingBaseline(chart, "2024-01", 12, "mean")
    const state = buildBudgetVsAverageTileState(
      chart,
      "2024-01",
      12,
      "mean",
      "total-spend",
      "dollars",
      15,
      pairs,
    )
    expect(state.sortedNames).toEqual(["Housing", "Healthcare"])
  })
})
