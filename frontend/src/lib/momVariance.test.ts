import { describe, expect, it } from "vitest"

import type { BarChartData } from "@/lib/barChart"
import {
  aggregateOtherDeltas,
  buildTrendDeltaSeries,
  compareDelta,
  defaultMonthPair,
  rankStacksByAbsDelta,
  rankTrendStacksByActivity,
  sliceTrendWindowMonths,
  trendDeltaMonths,
} from "@/lib/momVariance"

function makeChartData(
  months: string[],
  stacks: string[],
  data: Record<string, Record<string, number>>,
): BarChartData {
  return { months, stacks, data }
}

describe("compareDelta", () => {
  it("Groceries monthA=100 monthB=150 → delta +50", () => {
    const chart = makeChartData(
      ["2024-01", "2024-02"],
      ["Groceries"],
      {
        "2024-01": { Groceries: 100 },
        "2024-02": { Groceries: 150 },
      },
    )
    const deltas = compareDelta(chart, "2024-01", "2024-02")
    expect(deltas.get("Groceries")).toBe(50)
  })

  it("Dining monthA=80 monthB=50 → delta -30", () => {
    const chart = makeChartData(
      ["2024-01", "2024-02"],
      ["Dining"],
      {
        "2024-01": { Dining: 80 },
        "2024-02": { Dining: 50 },
      },
    )
    const deltas = compareDelta(chart, "2024-01", "2024-02")
    expect(deltas.get("Dining")).toBe(-30)
  })

  it("treats missing keys as zero", () => {
    const chart = makeChartData(["2024-01", "2024-02"], ["NewStack"], {})
    const deltas = compareDelta(chart, "2024-01", "2024-02")
    expect(deltas.get("NewStack")).toBe(0)
  })

  it("returns zero when monthA equals monthB", () => {
    const chart = makeChartData(
      ["2024-01"],
      ["Groceries"],
      { "2024-01": { Groceries: 100 } },
    )
    const deltas = compareDelta(chart, "2024-01", "2024-01")
    expect(deltas.get("Groceries")).toBe(0)
  })

  it("preserves Uncategorized stack name", () => {
    const chart = makeChartData(
      ["2024-01", "2024-02"],
      ["Uncategorized"],
      {
        "2024-01": { Uncategorized: 20 },
        "2024-02": { Uncategorized: 35 },
      },
    )
    const deltas = compareDelta(chart, "2024-01", "2024-02")
    expect(deltas.has("Uncategorized")).toBe(true)
    expect(deltas.get("Uncategorized")).toBe(15)
  })
})

describe("sliceTrendWindowMonths", () => {
  it("returns last 6 months when input has 8", () => {
    const months = [
      "2024-01",
      "2024-02",
      "2024-03",
      "2024-04",
      "2024-05",
      "2024-06",
      "2024-07",
      "2024-08",
    ]
    expect(sliceTrendWindowMonths(months)).toEqual([
      "2024-03",
      "2024-04",
      "2024-05",
      "2024-06",
      "2024-07",
      "2024-08",
    ])
  })

  it("returns all months when input has fewer than 6", () => {
    const months = ["2024-01", "2024-02", "2024-03", "2024-04"]
    expect(sliceTrendWindowMonths(months)).toEqual(months)
  })
})

describe("trendDeltaMonths", () => {
  it("drops the first month (no prior comparison)", () => {
    expect(trendDeltaMonths(["2024-01", "2024-02", "2024-03"])).toEqual([
      "2024-02",
      "2024-03",
    ])
  })
})

describe("defaultMonthPair", () => {
  it("uses second-to-last and last months", () => {
    expect(defaultMonthPair(["2024-01", "2024-02", "2024-03"])).toEqual({
      monthA: "2024-02",
      monthB: "2024-03",
    })
  })

  it("returns empty monthA for a single month", () => {
    expect(defaultMonthPair(["2024-03"])).toEqual({
      monthA: "",
      monthB: "2024-03",
    })
  })
})

describe("rankStacksByAbsDelta", () => {
  it("sorts by absolute delta descending", () => {
    const deltas = new Map([
      ["Small", 5],
      ["Large", -40],
      ["Medium", 20],
    ])
    const { names } = rankStacksByAbsDelta(deltas, 3)
    expect(names).toEqual(["Large", "Medium", "Small"])
  })

  it("includes Other when topN is less than stack count", () => {
    const deltas = new Map([
      ["A", 100],
      ["B", -80],
      ["C", 50],
      ["D", -10],
    ])
    const { names, includesOther } = rankStacksByAbsDelta(deltas, 2)
    expect(names).toEqual(["A", "B", "Other"])
    expect(includesOther).toBe(true)
  })
})

describe("aggregateOtherDeltas", () => {
  it("sums excluded stacks into Other", () => {
    const deltas = new Map([
      ["A", 100],
      ["B", -20],
      ["C", 30],
      ["D", -10],
    ])
    const aggregated = aggregateOtherDeltas(deltas, ["A", "B", "Other"])
    expect(aggregated.get("A")).toBe(100)
    expect(aggregated.get("B")).toBe(-20)
    expect(aggregated.get("Other")).toBe(20)
    expect(aggregated.has("C")).toBe(false)
    expect(aggregated.has("D")).toBe(false)
  })
})

describe("buildTrendDeltaSeries", () => {
  it("first month produces no delta point; second month is m2 minus m1", () => {
    const chart = makeChartData(
      ["2024-01", "2024-02", "2024-03"],
      ["Groceries"],
      {
        "2024-01": { Groceries: 100 },
        "2024-02": { Groceries: 120 },
        "2024-03": { Groceries: 90 },
      },
    )
    const window = ["2024-01", "2024-02", "2024-03"]
    const { deltaMonths, series } = buildTrendDeltaSeries(chart, window)
    expect(deltaMonths).toEqual(["2024-02", "2024-03"])
    expect(series).toEqual([
      { name: "Groceries", data: [20, -30] },
    ])
  })
})

describe("rankTrendStacksByActivity", () => {
  it("ranks by sum of absolute deltas over trend window", () => {
    const chart = makeChartData(
      ["2024-01", "2024-02", "2024-03"],
      ["Quiet", "Active"],
      {
        "2024-01": { Quiet: 10, Active: 10 },
        "2024-02": { Quiet: 11, Active: 50 },
        "2024-03": { Quiet: 12, Active: 20 },
      },
    )
    const { names } = rankTrendStacksByActivity(
      chart,
      ["2024-01", "2024-02", "2024-03"],
      2,
    )
    expect(names[0]).toBe("Active")
  })
})

describe("sign semantics", () => {
  it("positive delta means more outflow vs comparison month", () => {
    const chart = makeChartData(
      ["2024-01", "2024-02"],
      ["Budget"],
      {
        "2024-01": { Budget: 50 },
        "2024-02": { Budget: 75 },
      },
    )
    expect(compareDelta(chart, "2024-01", "2024-02").get("Budget")).toBeGreaterThan(
      0,
    )
  })

  it("negative delta means less outflow vs comparison month", () => {
    const chart = makeChartData(
      ["2024-01", "2024-02"],
      ["Budget"],
      {
        "2024-01": { Budget: 75 },
        "2024-02": { Budget: 50 },
      },
    )
    expect(compareDelta(chart, "2024-01", "2024-02").get("Budget")).toBeLessThan(0)
  })
})
