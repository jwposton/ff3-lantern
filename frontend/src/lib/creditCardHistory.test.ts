import { describe, expect, it } from "vitest"

import {
  aggregateCreditCardPortfolioTotals,
  computeCreditCardNetChange,
  creditCardNetChangeClassName,
  sumCardBalances,
} from "@/lib/creditCardHistory"
import type { CreditCardHistoryEnvelope } from "@/lib/paymentRunApi"

function history(totals: {
  charges: string
  fees: string
  interest: string
  payments: string
  net_change?: string
}): CreditCardHistoryEnvelope {
  const net_change =
    totals.net_change ??
    (
      Number.parseFloat(totals.charges) +
      Number.parseFloat(totals.interest) -
      Number.parseFloat(totals.payments)
    ).toFixed(2)
  return {
    account: {
      account_id: "1",
      name: "Card",
      owed: "100.00",
      apr_percent: "19.99",
      credit_limit: null,
      payment_due_day: null,
      funding_bucket_key: null,
    },
    window: { start: "2025-07-01", end: "2026-07-06" },
    stats_window: { start: "2025-07", end: "2026-07" },
    totals: { ...totals, net_change },
    monthly: [],
    transactions: [],
  }
}

describe("creditCardHistory", () => {
  it("aggregates portfolio totals across cards", () => {
    const result = aggregateCreditCardPortfolioTotals([
      history({
        charges: "100.00",
        fees: "5.00",
        interest: "10.00",
        payments: "200.00",
      }),
      history({
        charges: "50.00",
        fees: "0.00",
        interest: "2.50",
        payments: "75.00",
      }),
    ])
    expect(result).toEqual({
      charges: "150.00",
      fees: "5.00",
      interest: "12.50",
      payments: "275.00",
      net_change: "-112.50",
    })
  })

  it("computes net change from charges, interest, and payments", () => {
    expect(
      computeCreditCardNetChange({
        charges: "100.00",
        interest: "10.00",
        payments: "200.00",
      }),
    ).toBe("-90.00")
    expect(
      computeCreditCardNetChange({
        charges: "100.00",
        interest: "10.00",
        payments: "50.00",
      }),
    ).toBe("60.00")
  })

  it("colors net change red when positive and green when negative", () => {
    expect(creditCardNetChangeClassName("25.00")).toContain("destructive")
    expect(creditCardNetChangeClassName("-10.00")).toContain("emerald")
    expect(creditCardNetChangeClassName("0.00")).toBe("")
  })

  it("sums card balances", () => {
    expect(sumCardBalances(["1250.50", "300.00"])).toBe("1550.50")
  })
})
