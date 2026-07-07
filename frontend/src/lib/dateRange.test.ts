import { describe, expect, it } from "vitest"

import {
  isValidRange,
  last12Months,
  last24Months,
  monthToDate,
  parseStoredRange,
  previousMonthToDate,
  resolveInitialRange,
  STORAGE_KEY,
  validateDateString,
  yearToDate,
} from "@/lib/dateRange"

const FIXED_NOW = new Date(2024, 5, 15) // 2024-06-15 local

describe("date presets", () => {
  it("monthToDate returns first of month through today", () => {
    expect(monthToDate(FIXED_NOW)).toEqual(["2024-06-01", "2024-06-15"])
  })

  it("yearToDate returns Jan 1 through today", () => {
    expect(yearToDate(FIXED_NOW)).toEqual(["2024-01-01", "2024-06-15"])
  })

  it("previousMonthToDate returns first of previous month through today", () => {
    expect(previousMonthToDate(FIXED_NOW)).toEqual(["2024-05-01", "2024-06-15"])
  })

  it("last12Months returns same day 12 months ago through today", () => {
    expect(last12Months(FIXED_NOW)).toEqual(["2023-06-15", "2024-06-15"])
  })

  it("last24Months returns same day 24 months ago through today", () => {
    expect(last24Months(FIXED_NOW)).toEqual(["2022-06-15", "2024-06-15"])
  })
})

describe("validateDateString", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(validateDateString("2024-01-31")).toBe(true)
  })

  it("rejects malformed dates", () => {
    expect(validateDateString("2024-13-01")).toBe(false)
    expect(validateDateString("01/31/2024")).toBe(false)
    expect(validateDateString("")).toBe(false)
  })
})

describe("isValidRange", () => {
  it("requires valid start <= end", () => {
    expect(isValidRange("2024-01-01", "2024-01-31")).toBe(true)
    expect(isValidRange("2024-01-31", "2024-01-01")).toBe(false)
    expect(isValidRange("bad", "2024-01-01")).toBe(false)
  })
})

describe("parseStoredRange", () => {
  it("parses valid JSON range", () => {
    const stored = JSON.stringify({ start: "2024-03-01", end: "2024-03-31" })
    expect(parseStoredRange(stored)).toEqual(["2024-03-01", "2024-03-31"])
  })

  it("returns null for invalid JSON or range", () => {
    expect(parseStoredRange("not-json")).toBeNull()
    expect(parseStoredRange(JSON.stringify({ start: "x", end: "y" }))).toBeNull()
  })
})

describe("resolveInitialRange", () => {
  it("prefers valid URL params over localStorage", () => {
    const params = new URLSearchParams("start=2024-02-01&end=2024-02-29")
    const stored = JSON.stringify({ start: "2024-03-01", end: "2024-03-31" })
    expect(resolveInitialRange(params, stored, FIXED_NOW)).toEqual([
      "2024-02-01",
      "2024-02-29",
    ])
  })

  it("falls back to localStorage when URL empty", () => {
    const params = new URLSearchParams("")
    const stored = JSON.stringify({ start: "2024-03-01", end: "2024-03-31" })
    expect(resolveInitialRange(params, stored, FIXED_NOW)).toEqual([
      "2024-03-01",
      "2024-03-31",
    ])
  })

  it("defaults to monthToDate when URL and storage empty", () => {
    const params = new URLSearchParams("")
    expect(resolveInitialRange(params, null, FIXED_NOW)).toEqual([
      "2024-06-01",
      "2024-06-15",
    ])
  })

  it("falls through invalid URL to storage then MTD", () => {
    const params = new URLSearchParams("start=invalid&end=2024-01-31")
    const stored = JSON.stringify({ start: "2024-04-01", end: "2024-04-30" })
    expect(resolveInitialRange(params, stored, FIXED_NOW)).toEqual([
      "2024-04-01",
      "2024-04-30",
    ])

    expect(resolveInitialRange(params, null, FIXED_NOW)).toEqual([
      "2024-06-01",
      "2024-06-15",
    ])
  })

  it("exports STORAGE_KEY for DateRangeContext reuse", () => {
    expect(STORAGE_KEY).toBe("ff3analytics-date-range")
  })
})
