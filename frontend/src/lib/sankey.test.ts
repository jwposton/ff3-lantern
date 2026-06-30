import { describe, expect, it } from "vitest"

import type { OmniRow } from "@/types/NormalizedTransaction"
import {
  creditCardPaymentTransfer,
  creditCardPaymentTransferNoBudget,
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
  it("does NOT emit Bank Account (T) or Credit Card (T) nodes; leftmost are account (A)", () => {
    const data = buildSpendingSankeyData(
      spendingRows,
      "source-budget-category",
    )
    expect(data.nodes.some((n) => n.name.endsWith("(T)"))).toBe(false)
    expect(data.nodes.some((n) => n.name.endsWith("(A)"))).toBe(true)
    const displayNames = data.nodes.map((n) => n.displayName)
    expect(displayNames).toContain("Main Checking")
    expect(displayNames).toContain("Essentials")
    expect(displayNames).toContain("Food")
    expect(displayNames).not.toContain("Bank Accounts")
    expect(displayNames).not.toContain("Credit Cards")
  })

  it("links account (A) directly to budget (B) without type intermediary", () => {
    const data = buildSpendingSankeyData(
      spendingRows,
      "source-budget-category",
    )
    const accountToBudget = data.links.filter(
      (l) => l.source.endsWith("(A)") && l.target.endsWith("(B)"),
    )
    expect(accountToBudget.length).toBeGreaterThan(0)
    expect(data.links.some((l) => l.source.endsWith("(T)"))).toBe(false)
  })

  it("maps null budget to Uncategorized, not Undefined", () => {
    const data = buildSpendingSankeyData(
      [creditCardWithdrawal],
      "source-budget-category",
    )
    expect(data.nodes.some((n) => n.displayName === "Uncategorized")).toBe(true)
    expect(data.nodes.some((n) => n.displayName === "Undefined")).toBe(false)
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

  it("merges duplicate source→Other (C) links after bucketing", () => {
    const rows = [
      makeRow({ date: "2024-01-01", category: "SmallA", amount: "5", budget: "B1" }),
      makeRow({ date: "2024-01-02", category: "SmallB", amount: "5", budget: "B1" }),
      makeRow({ date: "2024-01-03", category: "TopCat", amount: "100", budget: "B1" }),
      makeRow({ date: "2024-01-04", category: "SmallC", amount: "5", budget: "B2" }),
      makeRow({ date: "2024-01-05", category: "SmallD", amount: "5", budget: "B2" }),
    ]
    const data = buildSpendingSankeyData(rows, "source-budget-category", 1)
    const toOther = data.links.filter((l) => l.target === "Other (C)")
    const bySource = new Map<string, number>()
    for (const l of toOther) {
      bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1)
    }
    for (const count of bySource.values()) {
      expect(count).toBe(1)
    }
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

  it("falls back to Credit Card Payment budget when CC transfer has null budget", () => {
    const data = buildCashFlowSankeyData(
      [creditCardPaymentTransferNoBudget],
      true,
    )
    expect(
      data.nodes.some((n) => n.displayName === "Credit Card Payment"),
    ).toBe(true)
    expect(
      data.nodes.some((n) => n.displayName === "Chase VISA Payment"),
    ).toBe(true)
    const budgetNode = data.nodes.find(
      (n) => n.displayName === "Credit Card Payment",
    )
    const catNode = data.nodes.find(
      (n) => n.displayName === "Chase VISA Payment",
    )
    expect(budgetNode?.name).toBe("Credit Card Payment_BUDGET")
    expect(catNode?.name).toBe("Chase VISA Payment_CAT")
  })

  it("uses destVal as budgetOut for bank→non-bank transfer with empty budget when not CC", () => {
    const transferToExpense: OmniRow = {
      amount: "50.00",
      type: "transfer",
      source_account: "Main Checking",
      source_type: "Asset account",
      source_role: "Default account",
      destination_account: "Grocery Store",
      destination_type: "Expense account",
      destination_role: null,
      budget: null,
      category: null,
      date: "2024-01-22",
    }
    const data = buildCashFlowSankeyData([transferToExpense], true)
    expect(data.nodes.some((n) => n.displayName === "Grocery Store")).toBe(
      true,
    )
    expect(data.nodes.some((n) => n.displayName === "Uncategorized")).toBe(
      false,
    )
  })

  it("transfer-in uses BankAccounts_BANK when aggregateBanks is true", () => {
    const transferIn: OmniRow = {
      amount: "100.00",
      type: "transfer",
      source_account: "Employer",
      source_type: "Revenue account",
      source_role: null,
      destination_account: "Main Checking",
      destination_type: "Asset account",
      destination_role: "Default account",
      budget: null,
      category: null,
      date: "2024-01-23",
    }
    const data = buildCashFlowSankeyData([transferIn], true)
    expect(data.nodes.some((n) => n.name === "BankAccounts_BANK")).toBe(true)
    expect(data.nodes.some((n) => n.name === "Main Checking_BANK")).toBe(false)
    expect(
      data.links.some(
        (l) =>
          l.source === "Employer_SRC" && l.target === "BankAccounts_BANK",
      ),
    ).toBe(true)
  })

  it("transfer-in uses per-account _BANK when aggregateBanks is false", () => {
    const transferIn: OmniRow = {
      amount: "100.00",
      type: "transfer",
      source_account: "Employer",
      source_type: "Revenue account",
      source_role: null,
      destination_account: "Main Checking",
      destination_type: "Asset account",
      destination_role: "Default account",
      budget: null,
      category: null,
      date: "2024-01-23",
    }
    const data = buildCashFlowSankeyData([transferIn], false)
    expect(data.nodes.some((n) => n.name === "Main Checking_BANK")).toBe(true)
    expect(data.nodes.some((n) => n.name === "BankAccounts_BANK")).toBe(false)
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

  it("selecting Other (C) returns rows whose category is NOT in top-N set", () => {
    const categories = ["CatA", "CatB", "CatC", "CatD"]
    const rows = categories.map((cat, i) =>
      makeRow({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        category: cat,
        amount: String((categories.length - i) * 10),
      }),
    )
    const filtered = filterRowsForDrilldown(
      rows,
      { name: "Other (C)", type: "Category", displayName: "Other" },
      2,
    )
    expect(filtered.every((r) => !["CatA", "CatB"].includes(r.category!))).toBe(
      true,
    )
    expect(filtered.some((r) => r.category === "CatC")).toBe(true)
    expect(filtered.some((r) => r.category === "CatD")).toBe(true)
  })

  it("Budget and Account drilldown filters unchanged when maxCategories provided", () => {
    const rows = [mainCheckingWithdrawal, creditCardWithdrawal]
    const budgetFiltered = filterRowsForDrilldown(
      rows,
      { name: "Essentials (B)", type: "Budget", displayName: "Essentials" },
      15,
    )
    expect(budgetFiltered).toHaveLength(1)
    expect(budgetFiltered[0].budget).toBe("Essentials")

    const accountFiltered = filterRowsForDrilldown(
      rows,
      {
        name: "Main Checking (A)",
        type: "Account",
        displayName: "Main Checking",
      },
      15,
    )
    expect(accountFiltered).toHaveLength(1)
    expect(accountFiltered[0].source_account).toBe("Main Checking")
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
