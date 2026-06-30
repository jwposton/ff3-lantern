import { describe, expect, it } from "vitest"

import {
  creditCardPaymentTransfer,
  creditCardWithdrawal,
  mainCheckingWithdrawal,
  savingsTransfer,
  spendingRowsForTopCategory,
  spendingRowsForTotal,
} from "@/test/fixtures/omniRows"
import {
  isSpendingExpense,
  isSpendingWithdrawal,
  isTrendCashOutflow,
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

describe("isTrendCashOutflow", () => {
  it("trend: includes bank asset withdrawals", () => {
    expect(isTrendCashOutflow(mainCheckingWithdrawal)).toBe(true)
  })

  it("trend: includes credit card payment transfers", () => {
    expect(isTrendCashOutflow(creditCardPaymentTransfer)).toBe(true)
  })

  it("trend: excludes credit card purchase withdrawals", () => {
    expect(isTrendCashOutflow(creditCardWithdrawal)).toBe(false)
  })

  it("trend: excludes non-CC internal transfers", () => {
    expect(isTrendCashOutflow(savingsTransfer)).toBe(false)
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
