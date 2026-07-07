import { describe, expect, it } from "vitest"

import {
  creditCardWithdrawal,
  mainCheckingWithdrawal,
} from "@/test/fixtures/omniRows"
import {
  isSpendingCashRail,
  isSpendingCreditRail,
  paymentRailLabel,
  rowMatchesPaymentRail,
} from "@/lib/spendingRail"

describe("spendingRail", () => {
  it("cash rail matches bank withdrawals only", () => {
    expect(isSpendingCashRail(mainCheckingWithdrawal)).toBe(true)
    expect(isSpendingCashRail(creditCardWithdrawal)).toBe(false)
  })

  it("credit rail matches credit card purchase withdrawals", () => {
    expect(isSpendingCreditRail(creditCardWithdrawal)).toBe(true)
    expect(isSpendingCreditRail(mainCheckingWithdrawal)).toBe(false)
  })

  it("rowMatchesPaymentRail dispatches by rail", () => {
    expect(rowMatchesPaymentRail(mainCheckingWithdrawal, "cash")).toBe(true)
    expect(rowMatchesPaymentRail(mainCheckingWithdrawal, "credit")).toBe(false)
    expect(rowMatchesPaymentRail(creditCardWithdrawal, "credit")).toBe(true)
    expect(rowMatchesPaymentRail(creditCardWithdrawal, "cash")).toBe(false)
  })

  it("paymentRailLabel returns user-facing rail names", () => {
    expect(paymentRailLabel("cash")).toBe("Cash")
    expect(paymentRailLabel("credit")).toBe("Credit")
  })
})
