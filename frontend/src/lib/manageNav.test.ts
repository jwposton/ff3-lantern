import { describe, expect, it } from "vitest"

import {
  buildCategorizeQueuePath,
  isUncategorizedDisplayName,
} from "./manageNav"

describe("manageNav", () => {
  describe("buildCategorizeQueuePath", () => {
    it("produces correct query string", () => {
      expect(buildCategorizeQueuePath("2024-01-01", "2024-01-31")).toBe(
        "/manage/categorize?start=2024-01-01&end=2024-01-31",
      )
    })

    it("URL-encodes date params", () => {
      expect(buildCategorizeQueuePath("2024-06-01", "2024-06-30")).toBe(
        "/manage/categorize?start=2024-06-01&end=2024-06-30",
      )
    })
  })

  describe("isUncategorizedDisplayName", () => {
    it("returns true for Uncategorized display label", () => {
      expect(isUncategorizedDisplayName("Uncategorized")).toBe(true)
    })

    it("returns false for other budget names and node keys", () => {
      expect(isUncategorizedDisplayName("Essentials")).toBe(false)
      expect(isUncategorizedDisplayName("Uncategorized (B)")).toBe(false)
    })
  })
})
