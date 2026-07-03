import { describe, expect, it } from "vitest"

import { formatDisplayAmount, formatDisplayDate } from "./formatDisplay"

describe("formatDisplayDate", () => {
  it("returns date part from ISO datetime", () => {
    expect(formatDisplayDate("2024-06-15T14:30:00.000Z")).toBe("2024-06-15")
  })

  it("returns plain date unchanged", () => {
    expect(formatDisplayDate("2024-06-15")).toBe("2024-06-15")
  })

  it("returns em dash for empty", () => {
    expect(formatDisplayDate("")).toBe("—")
    expect(formatDisplayDate(null)).toBe("—")
  })
})

describe("formatDisplayAmount", () => {
  it("formats to two decimals", () => {
    expect(formatDisplayAmount("-42")).toBe("-42.00")
    expect(formatDisplayAmount("9.9")).toBe("9.90")
  })

  it("returns em dash for empty", () => {
    expect(formatDisplayAmount("")).toBe("—")
  })
})
