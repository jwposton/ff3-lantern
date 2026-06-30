import { describe, expect, it } from "vitest"

import type { OmniRow } from "@/types/NormalizedTransaction"
import {
  creditCardPaymentTransfer,
  creditCardPaymentTransferMissingRole,
  creditCardPaymentTransferNoBudget,
  creditCardWithdrawal,
  mainCheckingWithdrawal,
} from "@/test/fixtures/omniRows"
import { buildBarChartData, barChartDataToLineSeries, filterRowsForDrilldown, TOTAL_LABEL } from "@/lib/barChart"
import { CC_PAYMENT_BUDGET_LABEL } from "@/lib/cashFlowLabels"
import { isCashFlowOutflow, isSpendingExpense } from "@/lib/spending"

function makeRow(overrides: Partial<OmniRow> & Pick<OmniRow, "date">): OmniRow {
  return { ...mainCheckingWithdrawal, ...overrides }
}

describe("buildBarChartData", () => {
  it("month: zero-fills months with no rows", () => {
    const rows = [makeRow({ date: "2026-01-15", budget: "Essentials" })]
    const result = buildBarChartData(rows, ["month", "budget"], {
      start: "2026-01-01",
      end: "2026-03-31",
    })
    expect(result.months).toEqual(["2026-01", "2026-02", "2026-03"])
    expect(result.data["2026-02"]?.["Essentials"]).toBe(0)
  })

  it("sort: stacks ordered descending by range total", () => {
    const rows = [
      makeRow({ date: "2026-01-10", budget: "Small", amount: "10.00" }),
      makeRow({ date: "2026-01-11", budget: "Large", amount: "100.00" }),
      makeRow({ date: "2026-02-01", budget: "Small", amount: "20.00" }),
    ]
    const result = buildBarChartData(rows, ["month", "budget"], {
      start: "2026-01-01",
      end: "2026-02-28",
    })
    expect(result.stacks).toEqual(["Large", "Small"])
  })

  it("drill: filters category stacks to selected budget", () => {
    const rows = [
      makeRow({
        date: "2026-01-10",
        budget: "Essentials",
        category: "Food",
        amount: "50.00",
      }),
      makeRow({
        date: "2026-01-11",
        budget: "Essentials",
        category: "Transport",
        amount: "30.00",
      }),
      makeRow({
        date: "2026-01-12",
        budget: "Fun",
        category: "Entertainment",
        amount: "200.00",
      }),
    ]
    const result = buildBarChartData(rows, ["month", "category"], {
      start: "2026-01-01",
      end: "2026-01-31",
      filter: { budget: "Essentials" },
    })
    expect(result.stacks).toContain("Food")
    expect(result.stacks).toContain("Transport")
    expect(result.stacks).not.toContain("Entertainment")
    expect(result.data["2026-01"]?.["Food"]).toBeCloseTo(50, 2)
    expect(result.data["2026-01"]?.["Transport"]).toBeCloseTo(30, 2)
  })

  it("uncategorized: null budget maps to Uncategorized stack", () => {
    const rows = [creditCardWithdrawal]
    const result = buildBarChartData(rows, ["month", "budget"], {
      start: "2024-01-01",
      end: "2024-01-31",
    })
    expect(result.stacks).toEqual(["Uncategorized"])
    expect(result.data["2024-01"]?.["Uncategorized"]).toBeCloseTo(100, 2)
  })

  it("slice: transfer rows do not contribute when caller pre-filters spending", () => {
    const rows = [
      makeRow({ date: "2026-01-10", budget: "Essentials", amount: "75.50" }),
      creditCardPaymentTransfer,
      { ...creditCardPaymentTransfer, date: "2026-01-15" },
    ].filter(isSpendingExpense)
    const result = buildBarChartData(rows, ["month", "budget"], {
      start: "2026-01-01",
      end: "2026-01-31",
    })
    expect(result.data["2026-01"]?.["Essentials"]).toBeCloseTo(75.5, 2)
    expect(result.stacks).toEqual(["Essentials"])
  })

  it("slice: cash-outflow pre-filtered rows produce non-empty stacks", () => {
    const rows = [
      creditCardPaymentTransfer,
      { ...creditCardPaymentTransfer, date: "2026-02-01", amount: "150.00" },
      mainCheckingWithdrawal,
    ].filter(isCashFlowOutflow)
    const result = buildBarChartData(rows, ["month", "budget"], {
      start: "2024-01-01",
      end: "2026-02-28",
      useCashFlowLabels: true,
    })
    expect(result.stacks.length).toBeGreaterThan(0)
    expect(result.data["2024-01"]?.[CC_PAYMENT_BUDGET_LABEL]).toBeCloseTo(200, 2)
    expect(result.data["2026-02"]?.[CC_PAYMENT_BUDGET_LABEL]).toBeCloseTo(150, 2)
  })

  it("cash flow labels: missing-role CC transfers stack under CC Payment budget", () => {
    const rows = [creditCardPaymentTransferMissingRole].filter(isCashFlowOutflow)
    const result = buildBarChartData(rows, ["month", "budget"], {
      start: "2024-01-01",
      end: "2024-01-31",
      useCashFlowLabels: true,
    })
    expect(result.stacks).toEqual([CC_PAYMENT_BUDGET_LABEL])
    expect(result.data["2024-01"]?.[CC_PAYMENT_BUDGET_LABEL]).toBeCloseTo(350, 2)
  })

  it("cash flow labels: CC transfer category drilldown uses card account name", () => {
    const rows = [creditCardPaymentTransfer, mainCheckingWithdrawal].filter(
      isCashFlowOutflow,
    )
    const result = buildBarChartData(rows, ["month", "category"], {
      start: "2024-01-01",
      end: "2024-01-31",
      filter: { budget: CC_PAYMENT_BUDGET_LABEL },
      useCashFlowLabels: true,
    })
    expect(result.stacks).toEqual(["Chase VISA"])
    expect(result.data["2024-01"]?.["Chase VISA"]).toBeCloseTo(200, 2)
  })

  it("cash flow labels: null-budget CC transfer stacks under CC Payment", () => {
    const rows = [creditCardPaymentTransferNoBudget].filter(isCashFlowOutflow)
    const result = buildBarChartData(rows, ["month", "budget"], {
      start: "2024-01-01",
      end: "2024-01-31",
      useCashFlowLabels: true,
    })
    expect(result.stacks).toEqual([CC_PAYMENT_BUDGET_LABEL])
    expect(result.data["2024-01"]?.[CC_PAYMENT_BUDGET_LABEL]).toBeCloseTo(200, 2)
  })

  it("uncategorized: empty category label maps to Uncategorized", () => {
    const rows = [
      makeRow({
        date: "2026-01-10",
        budget: "Essentials",
        category: "",
        amount: "25.00",
      }),
    ]
    const result = buildBarChartData(rows, ["month", "category"], {
      start: "2026-01-01",
      end: "2026-01-31",
    })
    expect(result.stacks).toEqual(["Uncategorized"])
    expect(result.data["2026-01"]?.["Uncategorized"]).toBeCloseTo(25, 2)
  })

  it("drill: filters payee stacks to selected budget and category", () => {
    const rows = [
      makeRow({
        date: "2026-01-10",
        budget: "Essentials",
        category: "Food",
        destination_account: "Store A",
        amount: "40.00",
      }),
      makeRow({
        date: "2026-01-11",
        budget: "Essentials",
        category: "Food",
        destination_account: "Store B",
        amount: "35.00",
      }),
      makeRow({
        date: "2026-01-12",
        budget: "Essentials",
        category: "Transport",
        destination_account: "Gas Station",
        amount: "20.00",
      }),
    ]
    const result = buildBarChartData(rows, ["month", "payee"], {
      start: "2026-01-01",
      end: "2026-01-31",
      filter: { budget: "Essentials", category: "Food" },
    })
    expect(result.stacks).toContain("Store A")
    expect(result.stacks).toContain("Store B")
    expect(result.stacks).not.toContain("Gas Station")
    expect(result.data["2026-01"]?.["Store A"]).toBeCloseTo(40, 2)
  })
})

describe("filterRowsForDrilldown", () => {
  it("filters by budget, category, and payee labels", () => {
    const rows = [
      makeRow({
        date: "2026-01-10",
        budget: "Essentials",
        category: "Food",
        destination_account: "Store A",
      }),
      makeRow({
        date: "2026-01-11",
        budget: "Essentials",
        category: "Food",
        destination_account: "Store B",
      }),
    ]
    const filtered = filterRowsForDrilldown(
      rows,
      { budget: "Essentials", category: "Food", payee: "Store A" },
      false,
    )
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.destination_account).toBe("Store A")
  })
})

describe("barChartDataToLineSeries", () => {
  const chartData = {
    months: ["2026-01", "2026-02"],
    stacks: ["Groceries", "Transport"],
    data: {
      "2026-01": { Groceries: 100, Transport: 50 },
      "2026-02": { Groceries: 80, Transport: 20 },
    },
  }

  it("maps stacks to one series per budget with correct monthly values", () => {
    const series = barChartDataToLineSeries(chartData)

    expect(series).toHaveLength(2)
    expect(series[0]).toEqual({
      name: "Groceries",
      data: [100, 80],
    })
    expect(series[1]).toEqual({
      name: "Transport",
      data: [50, 20],
    })
  })

  it("includeTotal true appends dashed Total series summing stacks per month", () => {
    const series = barChartDataToLineSeries(chartData, { includeTotal: true })

    expect(series).toHaveLength(3)
    const total = series.find((s) => s.name === TOTAL_LABEL)
    expect(total).toEqual({
      name: TOTAL_LABEL,
      data: [150, 100],
      dashed: true,
    })
  })

  it("includeTotal false returns budget series only", () => {
    const series = barChartDataToLineSeries(chartData, { includeTotal: false })

    expect(series).toHaveLength(2)
    expect(series.every((s) => !s.dashed)).toBe(true)
  })
})
