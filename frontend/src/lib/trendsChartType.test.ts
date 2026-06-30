import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CHART_TYPE_STORAGE_KEY,
  readTrendChartType,
  writeTrendChartType,
} from "@/lib/trendsChartType"

describe("trendsChartType", () => {
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

  it("defaults to line when localStorage is empty", () => {
    expect(readTrendChartType()).toBe("line")
  })

  it("persists stacked-bar under ff3-trends-chart-type", () => {
    writeTrendChartType("stacked-bar")
    expect(storage.get(CHART_TYPE_STORAGE_KEY)).toBe("stacked-bar")
    expect(readTrendChartType()).toBe("stacked-bar")
  })

  it("persists line mode", () => {
    writeTrendChartType("line")
    expect(readTrendChartType()).toBe("line")
  })

  it("falls back to line for invalid stored values", () => {
    storage.set(CHART_TYPE_STORAGE_KEY, "invalid")
    expect(readTrendChartType()).toBe("line")
  })
})
