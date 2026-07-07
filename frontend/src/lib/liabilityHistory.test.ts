import { describe, expect, it } from "vitest"

import {
  aggregateLiabilityPortfolioTotals,
  sumLiabilityBalances,
} from "@/lib/liabilityHistory"
import type { LiabilityHistoryEnvelope } from "@/lib/paymentRunApi"

function history(totals: {
  principal: string
  interest: string
  total_payment: string
}): LiabilityHistoryEnvelope {
  return {
    account: {
      account_id: "42",
      name: "Mortgage",
      owed: "50000.00",
      est_interest: "250.00",
      funding_bucket_key: null,
      loan_configured: true,
    },
    window: { start: "2025-07-01", end: "2026-07-06" },
    stats_window: { start: "2025-07", end: "2026-07" },
    totals,
    monthly: [],
    transactions: [],
  }
}

describe("liabilityHistory", () => {
  it("aggregates portfolio totals across liabilities", () => {
    const result = aggregateLiabilityPortfolioTotals([
      history({
        principal: "300.00",
        interest: "127.18",
        total_payment: "427.18",
      }),
      history({
        principal: "150.00",
        interest: "50.00",
        total_payment: "200.00",
      }),
    ])
    expect(result).toEqual({
      principal: "450.00",
      interest: "177.18",
      total_payment: "627.18",
    })
  })

  it("sums liability balances", () => {
    expect(sumLiabilityBalances(["50000.00", "12000.00"])).toBe("62000.00")
  })
})
