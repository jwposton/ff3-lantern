import { describe, expect, it } from "vitest"

import {
  computeCreditCardSubtotals,
  displayPlannedAmountInput,
  displayUserBalanceInput,
  formatInterestPercent,
  formatPaymentDueDay,
  isLastPaymentInWorksheetMonth,
  isPaymentDueUrgent,
  isSoftPlannedAmount,
  isSoftUserBalance,
  parsePaymentDueDayInput,
  resolvePlannedAmountCommit,
  resolveUserBalanceCommit,
  shouldHighlightCreditCardDue,
} from "./paymentRunFormat"

describe("paymentRunFormat", () => {
  it("formats payment due day", () => {
    expect(formatPaymentDueDay("15")).toBe("15")
    expect(formatPaymentDueDay(null)).toBe("—")
    expect(formatPaymentDueDay("0")).toBe("—")
  })

  it("parses payment due day input", () => {
    expect(parsePaymentDueDayInput("15")).toBe("15")
    expect(parsePaymentDueDayInput("31")).toBe("31")
    expect(parsePaymentDueDayInput("0")).toBeNull()
    expect(parsePaymentDueDayInput("")).toBeNull()
  })

  it("formats interest percent", () => {
    expect(formatInterestPercent("24.99")).toBe("24.99%")
    expect(formatInterestPercent(null)).toBe("—")
  })

  it("computes credit card subtotals with balance-weighted APR", () => {
    const totals = computeCreditCardSubtotals([
      {
        credit_limit: "10000",
        apr_percent: "20",
        owed: "1000",
        last_payment_amount: "200",
        new_total: "50",
        interest_accrued: "10",
        fees: "5",
        planned_amount: "400",
        paid_at: null,
      },
      {
        credit_limit: "5000",
        apr_percent: "30",
        owed: "3000",
        last_payment_amount: "500",
        new_total: "100",
        interest_accrued: "20",
        fees: "0",
        planned_amount: "500",
        paid_at: "2026-07-01T00:00:00Z",
      },
    ])

    expect(totals.owed).toBe(4000)
    expect(totals.credit_limit).toBe(15000)
    expect(totals.planned_amount).toBe(900)
    expect(totals.paid_count).toBe(1)
    // (1000*20 + 3000*30) / 4000 = 27.5
    expect(totals.weighted_apr).toBeCloseTo(27.5)
    // 4000 / 15000 * 100
    expect(totals.portfolio_util).toBeCloseTo(26.666, 2)
  })

  it("treats unset planned amount as soft zero", () => {
    const row = { planned_amount: "0.00", planned_amount_override: false }
    expect(isSoftPlannedAmount(row)).toBe(true)
    expect(displayPlannedAmountInput(row)).toBe("")
    expect(resolvePlannedAmountCommit(row, "")).toBeNull()
    expect(resolvePlannedAmountCommit(row, "400")).toEqual({
      planned_amount: "400",
    })
  })

  it("clears manual planned amount back to soft zero", () => {
    const row = { planned_amount: "400.00", planned_amount_override: true }
    expect(resolvePlannedAmountCommit(row, "")).toEqual({
      planned_amount: "0.00",
      clear_planned_override: true,
    })
    expect(resolvePlannedAmountCommit(row, "400.00")).toBeNull()
  })

  it("treats unset user balance as soft reported match", () => {
    const bucket = {
      reported_balance: "5000.00",
      user_balance: "5000.00",
      user_balance_override: false,
    }
    expect(isSoftUserBalance(bucket)).toBe(true)
    expect(displayUserBalanceInput(bucket)).toBe("")
    expect(resolveUserBalanceCommit(bucket, "")).toBeNull()
    expect(resolveUserBalanceCommit(bucket, "4800")).toEqual({
      user_balance: "4800",
    })
  })

  it("clears manual user balance back to reported", () => {
    const bucket = {
      reported_balance: "5000.00",
      user_balance: "4800.00",
      user_balance_override: true,
    }
    expect(resolveUserBalanceCommit(bucket, "")).toEqual({
      user_balance: "0.00",
      reset_to_reported: true,
    })
    expect(resolveUserBalanceCommit(bucket, "4800.00")).toBeNull()
  })

  it("flags urgent due dates for unpaid cards without a payment this month", () => {
    const ref = new Date("2026-07-03T12:00:00Z")
    const row = {
      payment_due_day: "3",
      last_payment_date: "2026-06-20",
      paid_at: null,
    }

    expect(isPaymentDueUrgent("3", "2026-07", ref)).toBe(true)
    expect(isPaymentDueUrgent("4", "2026-07", ref)).toBe(false)
    expect(isPaymentDueUrgent("2", "2026-07", ref)).toBe(true)
    expect(isLastPaymentInWorksheetMonth("2026-07-01", "2026-07")).toBe(true)
    expect(shouldHighlightCreditCardDue(row, "2026-07", ref)).toBe(true)
    expect(
      shouldHighlightCreditCardDue(
        { ...row, paid_at: "2026-07-03T00:00:00Z" },
        "2026-07",
        ref,
      ),
    ).toBe(false)
    expect(
      shouldHighlightCreditCardDue(
        { ...row, last_payment_date: "2026-07-01" },
        "2026-07",
        ref,
      ),
    ).toBe(false)
  })
})
