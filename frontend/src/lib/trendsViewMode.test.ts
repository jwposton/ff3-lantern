import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  readTrendViewMode,
  STORAGE_KEY,
  writeTrendViewMode,
} from "@/lib/trendsViewMode"

describe("trendsViewMode", () => {
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

  it("defaults to category when localStorage is empty", () => {
    expect(readTrendViewMode()).toBe("category")
  })

  it("persists total mode under ff3-trends-view-mode", () => {
    writeTrendViewMode("total")
    expect(storage.get(STORAGE_KEY)).toBe("total")
    expect(readTrendViewMode()).toBe("total")
  })

  it("persists category mode under ff3-trends-view-mode", () => {
    writeTrendViewMode("category")
    expect(storage.get(STORAGE_KEY)).toBe("category")
    expect(readTrendViewMode()).toBe("category")
  })

  it("falls back to category for invalid stored values", () => {
    storage.set(STORAGE_KEY, "invalid")
    expect(readTrendViewMode()).toBe("category")
  })
})
