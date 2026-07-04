import { describe, expect, it } from "vitest"

import {
  isBankAccount,
  isCreditCard,
  isFundingBucketAsset,
  isSpendingBankAccount,
  normalizeAccountRole,
} from "@/lib/accounts"
import { spendingAccountTypeNode } from "@/lib/sankey"
import { creditCardWithdrawal, mainCheckingWithdrawal } from "@/test/fixtures/omniRows"

describe("accounts:", () => {
  it("classifies Credit card role as credit card, not bank", () => {
    expect(isCreditCard("Asset account", "Credit card")).toBe(true)
    expect(isBankAccount("Asset account", "Credit card")).toBe(false)
    expect(isSpendingBankAccount("Asset account", "Credit card")).toBe(false)
  })

  it("classifies raw Firefly creditCard role as credit card", () => {
    expect(normalizeAccountRole("creditCard")).toBe("Credit card")
    expect(isCreditCard("Asset account", "creditCard")).toBe(true)
    expect(isBankAccount("Asset account", "creditCard")).toBe(false)
    expect(isFundingBucketAsset("Asset account", "creditCard")).toBe(false)
  })

  it("classifies ccAsset as credit card and ineligible for funding buckets", () => {
    expect(normalizeAccountRole("ccAsset")).toBe("Credit card")
    expect(isFundingBucketAsset("asset", "ccAsset")).toBe(false)
    expect(isFundingBucketAsset("asset", "defaultAsset")).toBe(true)
  })

  it("classifies raw defaultAsset as bank for spending type layer", () => {
    expect(normalizeAccountRole("defaultAsset")).toBe("Default account")
    expect(isSpendingBankAccount("asset", "defaultAsset")).toBe(true)
  })

  it("does not treat spurious asset type-as-role as bank for spending", () => {
    expect(normalizeAccountRole("asset")).toBeNull()
    expect(isSpendingBankAccount("Asset account", "asset")).toBe(false)
    expect(spendingAccountTypeNode(creditCardWithdrawal)?.display).toBe(
      "Credit Cards",
    )
  })

  it("classifies Asset account with null role as bank for cash-flow helpers", () => {
    expect(isBankAccount("Asset account", null)).toBe(true)
    expect(isCreditCard("Asset account", null)).toBe(false)
    expect(isSpendingBankAccount("Asset account", null)).toBe(false)
  })

  it("routes null-role asset to Credit Cards in spending Sankey (not Bank Accounts)", () => {
    const row = { ...mainCheckingWithdrawal, source_role: null }
    expect(spendingAccountTypeNode(row)?.display).toBe("Credit Cards")
  })
})
