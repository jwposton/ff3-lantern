import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  readExpandedBillGroups,
  STORAGE_KEY,
  writeExpandedBillGroups,
} from "./worksheetBillGroupExpand"

describe("worksheetBillGroupExpand", () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
      clear: () => {
        storage.clear()
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns empty Set when localStorage is empty", () => {
    expect(readExpandedBillGroups()).toEqual(new Set())
  })

  it("round-trips expanded group ids via write then read", () => {
    writeExpandedBillGroups(new Set(["utilities", "insurance"]))
    expect(readExpandedBillGroups()).toEqual(new Set(["utilities", "insurance"]))
  })

  it("returns empty Set for invalid JSON without throwing", () => {
    storage.set(STORAGE_KEY, "not-json{")
    expect(readExpandedBillGroups()).toEqual(new Set())
  })

  it("returns empty Set for non-array JSON payload", () => {
    storage.set(STORAGE_KEY, JSON.stringify({ ids: ["utilities"] }))
    expect(readExpandedBillGroups()).toEqual(new Set())
  })

  it("filters non-string array elements", () => {
    storage.set(STORAGE_KEY, JSON.stringify(["utilities", 42, null, "insurance"]))
    expect(readExpandedBillGroups()).toEqual(new Set(["utilities", "insurance"]))
  })

  it("uses ff3-worksheet-bill-group-expanded storage key", () => {
    expect(STORAGE_KEY).toBe("ff3-worksheet-bill-group-expanded")
  })
})
