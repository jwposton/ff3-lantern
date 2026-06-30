import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  readAggregateBanks,
  STORAGE_KEY,
  writeAggregateBanks,
} from "@/lib/sankeyAggregateBanks"

describe("aggregateBanks:", () => {
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

  it("defaults to true when localStorage is empty", () => {
    expect(readAggregateBanks()).toBe(true)
  })

  it("persists false after writeAggregateBanks(false)", () => {
    writeAggregateBanks(false)
    expect(readAggregateBanks()).toBe(false)
  })

  it("uses ff3-cash-flow-sankey-aggregate-banks storage key", () => {
    expect(STORAGE_KEY).toBe("ff3-cash-flow-sankey-aggregate-banks")
  })
})
