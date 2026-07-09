import { describe, expect, it } from "vitest"

import {
  dependentsHubPath,
  externalLinkDependentsTotal,
  formatDependentsBreakdown,
  formatPortalHost,
} from "./externalLinkUtils"

describe("externalLinkUtils", () => {
  describe("externalLinkDependentsTotal", () => {
    it("sums section keys when total is absent", () => {
      expect(externalLinkDependentsTotal({ bills: 2, buckets: 1 })).toBe(3)
    })

    it("prefers total when present without double-counting sections", () => {
      expect(
        externalLinkDependentsTotal({ bills: 2, buckets: 2, total: 4 }),
      ).toBe(4)
    })

    it("returns zero for empty dependents", () => {
      expect(externalLinkDependentsTotal({})).toBe(0)
    })
  })

  describe("formatDependentsBreakdown", () => {
    it("produces sparse breakdown strings", () => {
      expect(formatDependentsBreakdown({ bills: 2, buckets: 1 })).toBe(
        "2 bills · 1 bucket",
      )
    })

    it("returns empty string when no dependents", () => {
      expect(formatDependentsBreakdown({})).toBe("")
    })
  })

  describe("formatPortalHost", () => {
    it("extracts hostname from HTTPS URL", () => {
      expect(formatPortalHost("https://chase.com/login")).toBe("chase.com")
    })

    it("falls back to raw string for invalid URLs", () => {
      expect(formatPortalHost("not-a-url")).toBe("not-a-url")
    })
  })

  describe("dependentsHubPath", () => {
    it("maps bills and liabilities to bills hub", () => {
      expect(dependentsHubPath("bills")).toBe("/manage/bills")
      expect(dependentsHubPath("liabilities")).toBe("/manage/bills")
    })

    it("maps buckets and accounts to payment-run hubs", () => {
      expect(dependentsHubPath("buckets")).toBe("/manage/payment-run/buckets")
      expect(dependentsHubPath("accounts")).toBe("/manage/payment-run/cards")
    })
  })
})
