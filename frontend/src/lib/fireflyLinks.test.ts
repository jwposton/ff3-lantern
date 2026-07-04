import { describe, expect, it } from "vitest"

import {
  buildFireflyAccountUrl,
  buildFireflyBillUrl,
  buildFireflyTransactionUrl,
} from "./fireflyLinks"

describe("buildFireflyTransactionUrl", () => {
  it("builds show URL from base and numeric journal id", () => {
    expect(buildFireflyTransactionUrl("https://ff.example/", "123")).toBe(
      "https://ff.example/transactions/show/123",
    )
  })

  it("strips trailing slash from base without double slash", () => {
    expect(buildFireflyTransactionUrl("https://ff.example", "456")).toBe(
      "https://ff.example/transactions/show/456",
    )
  })

  it("returns null for empty base", () => {
    expect(buildFireflyTransactionUrl("", "123")).toBeNull()
    expect(buildFireflyTransactionUrl(null, "123")).toBeNull()
  })

  it("returns null for empty or non-numeric journal id", () => {
    expect(buildFireflyTransactionUrl("https://ff.example", "")).toBeNull()
    expect(buildFireflyTransactionUrl("https://ff.example", "abc")).toBeNull()
    expect(buildFireflyTransactionUrl("https://ff.example", "12http")).toBeNull()
  })
})

describe("buildFireflyAccountUrl", () => {
  it("builds show URL from base and numeric account id", () => {
    expect(buildFireflyAccountUrl("https://ff.example/", "42")).toBe(
      "https://ff.example/accounts/show/42",
    )
  })

  it("returns null for empty base or invalid account id", () => {
    expect(buildFireflyAccountUrl("", "42")).toBeNull()
    expect(buildFireflyAccountUrl("https://ff.example", "abc")).toBeNull()
  })
})

describe("buildFireflyBillUrl", () => {
  it("builds show URL from base and numeric bill id", () => {
    expect(buildFireflyBillUrl("https://ff.example/", "99")).toBe(
      "https://ff.example/bills/show/99",
    )
  })

  it("returns null for empty base or invalid bill id", () => {
    expect(buildFireflyBillUrl("", "99")).toBeNull()
    expect(buildFireflyBillUrl("https://ff.example", "abc")).toBeNull()
  })
})
