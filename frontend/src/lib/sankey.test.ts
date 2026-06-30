import { describe, expect, it } from "vitest"

import type { OmniRow } from "@/types/NormalizedTransaction"
import {
  creditCardPaymentTransfer,
  creditCardWithdrawal,
  mainCheckingWithdrawal,
} from "@/test/fixtures/omniRows"
import { isSpendingExpense } from "@/lib/spending"
import {
  buildCashFlowSankeyData,
  buildSpendingSankeyData,
  filterRowsForDrilldown,
  isCashMovementRow,
} from "@/lib/sankey"

function makeRow(overrides: Partial<OmniRow> & Pick<OmniRow, "date">): OmniRow {
  return { ...mainCheckingWithdrawal, ...overrides }
}

const spendingRows = [
  mainCheckingWithdrawal,
  creditCardWithdrawal,
].filter(isSpendingExpense)

describe("spending:", () => {
  it("builds Account Type → Account → Budget → Category layers", () => {
    const data = buildSpendingSankeyData(
      spendingRows,
      "source-budget-category",
    )
    const displayNames = data.nodes.map((n) => n.displayName)
    expect(displayNames).toContain("Bank Accounts")
    expect(displayNames).toContain("Main Checking")
    expect(displayNames).toContain("Essentials")
    expect(displayNames).toContain("Food")
    expect(data.nodes.some((n) => n.name.endsWith("(A)"))).toBe(true)
    expect(data.nodes.some((n) => n.name.endsWith("(B)"))).toBe(true)
    expect(data.nodes.some((n) => n.name.endsWith("(C)"))).toBe(true)
  })

  it("maps null budget to Uncategorized, not Undefined", () => {
    const data = buildSpendingSankeyData(
      [creditCardWithdrawal],
      "source-budget-category",
    )
    expect(data.nodes.some((n) => n.displayName === "Uncategorized")).toBe(true)
    expect(data.nodes.some((n) => n.displayName === "Undefined")).toBe(false)
  })

  it("includes Credit Cards type node for CC withdrawals", () => {
    const data = buildSpendingSankeyData(
      [creditCardWithdrawal],
      "source-budget-category",
    )
    expect(data.nodes.some((n) => n.displayName === "Credit Cards")).toBe(true)
  })
})

describe("topN:", () => {
  it("buckets excess categories into Other (C)", () => {
    const categories = ["CatA", "CatB", "CatC", "CatD", "CatE", "CatF"]
    const rows = categories.map((cat, i) =>
      makeRow({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        category: cat,
        amount: String((categories.length - i) * 10),
      }),
    )
    const data = buildSpendingSankeyData(rows, "source-budget-category", 3)
    expect(data.nodes.some((n) => n.name === "Other (C)")).toBe(true)
    const otherTargets = data.links
      .filter((l) => l.target === "Other (C)")
      .map((l) => l.source)
    expect(otherTargets.length).toBeGreaterThan(0)
  })
})

describe("cashFlow:", () => {
  const salaryDeposit: OmniRow = {
    amount: "5000.00",
    type: "deposit",
    source_account: "Employer",
    source_type: "Revenue account",
    source_role: null,
    destination_account: "Main Checking",
    destination_type: "Asset account",
    destination_role: "Default account",
    budget: null,
    category: null,
    date: "2024-01-01",
  }

  const bankToBankTransfer: OmniRow = {
    amount: "100.00",
    type: "transfer",
    source_account: "Main Checking",
    source_type: "Asset account",
    source_role: "Default account",
    destination_account: "Savings",
    destination_type: "Asset account",
    destination_role: "Savings",
    budget: null,
    category: null,
    date: "2024-01-02",
  }

  it("creates source→bank link for deposits; skips bank↔bank", () => {
    const aggregated = buildCashFlowSankeyData(
      [salaryDeposit, bankToBankTransfer],
      true,
    )
    expect(
      aggregated.links.some(
        (l) => l.source.endsWith("_SRC") && l.target === "BankAccounts_BANK",
      ),
    ).toBe(true)
    expect(aggregated.links.length).toBe(1)
  })

  it("uses BankAccounts_BANK when aggregateBanks is true", () => {
    const data = buildCashFlowSankeyData([mainCheckingWithdrawal], true)
    expect(data.nodes.some((n) => n.name === "BankAccounts_BANK")).toBe(true)
  })

  it("uses individual _BANK keys when aggregateBanks is false", () => {
    const data = buildCashFlowSankeyData([mainCheckingWithdrawal], false)
    expect(data.nodes.some((n) => n.name === "Main Checking_BANK")).toBe(true)
    expect(data.nodes.some((n) => n.name === "BankAccounts_BANK")).toBe(false)
  })

  it("preserves Credit Card Payment budget from CC payment transfers", () => {
    const data = buildCashFlowSankeyData([creditCardPaymentTransfer], true)
    expect(
      data.nodes.some((n) => n.displayName === "Credit Card Payment"),
    ).toBe(true)
  })
})

describe("drilldown:", () => {
  it("filters Budget node rows by budget displayName", () => {
    const rows = [mainCheckingWithdrawal, creditCardWithdrawal]
    const filtered = filterRowsForDrilldown(rows, {
      name: "Essentials (B)",
      type: "Budget",
      displayName: "Essentials",
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].budget).toBe("Essentials")
  })

  it("filters AccountType Bank Accounts via isBankAccount, not displayName string match on rows", () => {
    const rows = [mainCheckingWithdrawal, creditCardWithdrawal]
    const filtered = filterRowsForDrilldown(rows, {
      name: "Bank Account (T)",
      type: "AccountType",
      displayName: "Bank Accounts",
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].source_account).toBe("Main Checking")
  })
})

describe("isCashMovementRow", () => {
  const salaryDeposit: OmniRow = {
    amount: "5000.00",
    type: "deposit",
    source_account: "Employer",
    source_type: "Revenue account",
    source_role: null,
    destination_account: "Main Checking",
    destination_type: "Asset account",
    destination_role: "Default account",
    budget: null,
    category: null,
    date: "2024-01-01",
  }

  const bankToBankTransfer: OmniRow = {
    amount: "100.00",
    type: "transfer",
    source_account: "Main Checking",
    source_type: "Asset account",
    source_role: "Default account",
    destination_account: "Savings",
    destination_type: "Asset account",
    destination_role: "Savings",
    budget: null,
    category: null,
    date: "2024-01-02",
  }

  it("includes deposits and bank withdrawals; excludes bank↔bank only rows", () => {
    expect(isCashMovementRow(salaryDeposit)).toBe(true)
    expect(isCashMovementRow(mainCheckingWithdrawal)).toBe(true)
    expect(isCashMovementRow(bankToBankTransfer)).toBe(false)
  })
})
