import { describe, expect, it } from "vitest"

import {
  creditCardPaymentTransfer,
  creditCardWithdrawal,
  liabilityPaymentTransfer,
  mainCheckingWithdrawal,
  salaryDeposit,
  savingsTransfer,
  spendingRowsForTopCategory,
  spendingRowsForTotal,
} from "@/test/fixtures/omniRows"
import {
  cashFlowInflowTotal,
  cashFlowOutflowTotal,
  isCashFlowInflow,
  isCashFlowOutflow,
  isSpendingExpense,
  isSpendingWithdrawal,
  monthCashFlowKpi,
  netCashFlowTotal,
  spendingExpenseTotal,
  spendingWithdrawalTotal,
  topCategoryBySpend,
} from "@/lib/spending"

describe("isSpendingExpense", () => {
  it("expense: includes bank asset withdrawals", () => {
    expect(isSpendingExpense(mainCheckingWithdrawal)).toBe(true)
  })

  it("expense: includes credit card purchase withdrawals", () => {
    expect(isSpendingExpense(creditCardWithdrawal)).toBe(true)
  })

  it("expense: excludes CC payment transfers", () => {
    expect(isSpendingExpense(creditCardPaymentTransfer)).toBe(false)
  })

  it("expense: excludes non-withdrawal transfers", () => {
    expect(isSpendingExpense(savingsTransfer)).toBe(false)
  })

  it("expense: isSpendingWithdrawal remains false for CC purchases (D-12)", () => {
    expect(isSpendingWithdrawal(creditCardWithdrawal)).toBe(false)
  })
})

describe("isCashFlowOutflow", () => {
  it("includes bank asset withdrawals", () => {
    expect(isCashFlowOutflow(mainCheckingWithdrawal)).toBe(true)
  })

  it("includes credit card payment transfers", () => {
    expect(isCashFlowOutflow(creditCardPaymentTransfer)).toBe(true)
  })

  it("includes bank transfers to liability accounts", () => {
    expect(isCashFlowOutflow(liabilityPaymentTransfer)).toBe(true)
  })

  it("excludes credit card purchase withdrawals (Spending only)", () => {
    expect(isCashFlowOutflow(creditCardWithdrawal)).toBe(false)
  })

  it("excludes CC purchases mislabeled with missing source role", () => {
    const mislabeled = { ...creditCardWithdrawal, source_role: null }
    expect(isCashFlowOutflow(mislabeled)).toBe(false)
  })

  it("excludes bank-to-bank internal transfers", () => {
    expect(isCashFlowOutflow(savingsTransfer)).toBe(false)
  })

  it("excludes salary deposits (inflows)", () => {
    expect(isCashFlowOutflow(salaryDeposit)).toBe(false)
  })
})

describe("isCashFlowInflow", () => {
  it("includes salary deposits to bank accounts", () => {
    expect(isCashFlowInflow(salaryDeposit)).toBe(true)
  })

  it("excludes bank withdrawals", () => {
    expect(isCashFlowInflow(mainCheckingWithdrawal)).toBe(false)
  })

  it("excludes bank-to-bank transfers", () => {
    expect(isCashFlowInflow(savingsTransfer)).toBe(false)
  })

  it("excludes credit card purchases", () => {
    expect(isCashFlowInflow(creditCardWithdrawal)).toBe(false)
  })
})

describe("monthCashFlowKpi", () => {
  const januaryRows = [
    salaryDeposit,
    mainCheckingWithdrawal,
    creditCardWithdrawal,
    creditCardPaymentTransfer,
  ]

  it("computes net cash flow as bank inflows minus outflows", () => {
    expect(cashFlowInflowTotal(januaryRows)).toBeCloseTo(5000, 2)
    expect(cashFlowOutflowTotal(januaryRows)).toBeCloseTo(275.5, 2)
    expect(netCashFlowTotal(januaryRows)).toBeCloseTo(4724.5, 2)
  })

  it("reports spending with credit card purchases and income separately", () => {
    const kpi = monthCashFlowKpi(januaryRows)
    expect(kpi.spending).toBeCloseTo(175.5, 2)
    expect(kpi.income).toBeCloseTo(5000, 2)
    expect(kpi.netCashFlow).toBeCloseTo(4724.5, 2)
  })

  it("spendingExpenseTotal includes credit card purchases", () => {
    expect(spendingExpenseTotal(januaryRows)).toBeCloseTo(175.5, 2)
  })
})

describe("spendingWithdrawalTotal", () => {
  it("total: sums asset non-credit-card withdrawals within tolerance", () => {
    const total = spendingWithdrawalTotal(spendingRowsForTotal)
    expect(Math.abs(total - 75.5)).toBeLessThanOrEqual(0.01)
  })

  it("total: excludes credit card source withdrawals", () => {
    const rows = spendingRowsForTotal.filter(isSpendingWithdrawal)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.amount).toBe("75.50")
  })
})

describe("topCategoryBySpend", () => {
  it("topCategory: returns name, amount, and percent of total spending", () => {
    const top = topCategoryBySpend(spendingRowsForTopCategory)
    expect(top.name).toBe("Food")
    expect(top.amount).toBeCloseTo(75.5, 2)
    expect(top.percentOfTotal).toBeCloseTo(75.5 / 125.5, 4)
  })

  it("topCategory: maps null category to Uncategorized label", () => {
    const rows = spendingRowsForTopCategory.filter(
      (r) => r.category === null && isSpendingWithdrawal(r),
    )
    expect(rows).toHaveLength(1)
    const top = topCategoryBySpend([rows[0]!])
    expect(top.name).toBe("Uncategorized")
  })
})
