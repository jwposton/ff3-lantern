import { describe, expect, it } from "vitest"

import { mainCheckingWithdrawal, salaryDeposit } from "@/test/fixtures/omniRows"
import { buildBudgetPieSlices } from "@/lib/dashboardKpis"
import { isSpendingExpense } from "@/lib/spending"

describe("buildBudgetPieSlices", () => {
  it("aggregates spending rows by budget for a date window", () => {
    const slices = buildBudgetPieSlices(
      [mainCheckingWithdrawal, salaryDeposit],
      "2024-01-01",
      "2024-01-31",
      { rowFilter: isSpendingExpense },
    )
    expect(slices).toEqual([{ name: "Essentials", value: 75.5 }])
  })
})
