import { describe, expect, it } from "vitest"

import type { OmniRow } from "@/types/NormalizedTransaction"
import {
  creditCardPaymentTransfer,
  mainCheckingWithdrawal,
  transportWithdrawal,
  uncategorizedWithdrawal,
} from "@/test/fixtures/omniRows"
import {
  buildTrendSeries,
  enumerateMonths,
  rankCategoriesByRangeTotal,
  sumByMonth,
} from "@/lib/trends"
import { isTrendCashOutflow } from "@/lib/spending"

function makeCategoryRow(
  category: string | null,
  amount: string,
  date: string,
): OmniRow {
  return {
    ...mainCheckingWithdrawal,
    category,
    amount,
    date,
  }
}

describe("enumerateMonths", () => {
  it("month: emits every YYYY-MM between start and end inclusive", () => {
    expect(enumerateMonths("2026-01-15", "2026-03-02")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ])
  })

  it("month: handles year rollover", () => {
    expect(enumerateMonths("2025-11-01", "2026-02-28")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ])
  })
})

describe("sumByMonth", () => {
  it("sum: zero-fills months with no rows", () => {
    const months = enumerateMonths("2024-01-01", "2024-03-31")
    const totals = sumByMonth([mainCheckingWithdrawal], months)
    expect(totals.get("2024-01")).toBeCloseTo(75.5, 2)
    expect(totals.get("2024-02")).toBe(0)
    expect(totals.get("2024-03")).toBe(0)
  })
})

describe("rankCategoriesByRangeTotal", () => {
  it("topN: returns top N categories plus Other when remainder exists", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeCategoryRow(`Cat${i}`, String((10 - i) * 10), "2024-01-15"),
    )
    const { series, includesOther } = rankCategoriesByRangeTotal(rows, 8)
    expect(series).toHaveLength(9)
    expect(series.slice(0, 8)).toEqual([
      "Cat0",
      "Cat1",
      "Cat2",
      "Cat3",
      "Cat4",
      "Cat5",
      "Cat6",
      "Cat7",
    ])
    expect(series[8]).toBe("Other")
    expect(includesOther).toBe(true)
  })

  it("topN: Uncategorized competes as its own series label", () => {
    const rows = [
      makeCategoryRow("Food", "100", "2024-01-01"),
      uncategorizedWithdrawal,
    ].filter(isTrendCashOutflow)
    const { series } = rankCategoriesByRangeTotal(rows, 8)
    expect(series).toContain("Uncategorized")
    expect(series).toContain("Food")
  })
})

describe("buildTrendSeries", () => {
  it("builds single series in total mode", () => {
    const rows = [
      mainCheckingWithdrawal,
      creditCardPaymentTransfer,
      transportWithdrawal,
    ]
    const result = buildTrendSeries({
      rows,
      start: "2024-01-01",
      end: "2024-01-31",
      mode: "total",
    })
    expect(result.months).toEqual(["2024-01"])
    expect(result.series).toHaveLength(1)
    expect(result.series[0]?.name).toBe("Total")
    expect(result.totalOverlay).toBeNull()
    expect(result.series[0]?.data[0]).toBeCloseTo(305.5, 2)
  })

  it("builds multi-series plus total overlay in category mode", () => {
    const rows = [
      mainCheckingWithdrawal,
      transportWithdrawal,
      creditCardPaymentTransfer,
    ]
    const result = buildTrendSeries({
      rows,
      start: "2024-01-01",
      end: "2024-01-31",
      mode: "category",
      topN: 8,
    })
    expect(result.series.length).toBeGreaterThan(1)
    expect(result.totalOverlay).not.toBeNull()
    expect(result.totalOverlay?.name).toBe("Total")
    expect(result.totalOverlay?.data[0]).toBeCloseTo(305.5, 2)
    const categoryNames = result.series.map((s) => s.name)
    expect(categoryNames).toContain("Food")
    expect(categoryNames).toContain("Transport")
    expect(categoryNames).toContain("Chase VISA Payment")
  })
})
