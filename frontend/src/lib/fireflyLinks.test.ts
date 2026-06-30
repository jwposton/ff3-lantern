import { describe, expect, it } from "vitest"

import { buildFireflyTransactionUrl } from "./fireflyLinks"

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
