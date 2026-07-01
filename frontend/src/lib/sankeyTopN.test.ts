import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  readSankeyTopN,
  STORAGE_KEY,
  writeSankeyTopN,
} from "@/lib/sankeyTopN"

describe("topN:", () => {
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

  it("defaults to 15 when localStorage is empty", () => {
    expect(readSankeyTopN()).toBe(15)
  })

  it("clamps high values to 25", () => {
    writeSankeyTopN(30)
    expect(readSankeyTopN()).toBe(25)
  })

  it("clamps low values to 10", () => {
    writeSankeyTopN(3)
    expect(readSankeyTopN()).toBe(10)
  })

  it("clamps stored value 8 to 10 on read", () => {
    storage.set(STORAGE_KEY, "8")
    expect(readSankeyTopN()).toBe(10)
  })

  it("uses ff3-spending-sankey-top-n storage key", () => {
    expect(STORAGE_KEY).toBe("ff3-spending-sankey-top-n")
  })
})
