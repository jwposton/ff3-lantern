import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  BillSuggestionAmountDisplay,
  formatSuggestionAmountRange,
  isFixedSuggestionAmount,
} from "./BillSuggestionBucketSection"

describe("isFixedSuggestionAmount", () => {
  it("treats equal min and max as fixed", () => {
    expect(isFixedSuggestionAmount("22.15", "22.15")).toBe(true)
  })

  it("treats sub-cent spread as fixed", () => {
    expect(isFixedSuggestionAmount("10.00", "10.009")).toBe(true)
  })

  it("treats wider spread as variable", () => {
    expect(isFixedSuggestionAmount("82.15", "110.05")).toBe(false)
  })
})

describe("formatSuggestionAmountRange", () => {
  it("spaces the dash and suppresses trailing .00", () => {
    expect(formatSuggestionAmountRange("82.00", "110.05")).toBe("82 - 110.05")
  })
})

describe("BillSuggestionAmountDisplay", () => {
  it("shows a single compact amount for fixed bills", () => {
    render(
      <BillSuggestionAmountDisplay
        row={{ amount_min: "22.00", amount_avg: "22.00", amount_max: "22.00" }}
      />,
    )
    expect(screen.getByText("22")).toBeTruthy()
    expect(screen.queryByText(/ - /)).toBeNull()
  })

  it("shows avg primary with muted min-max range for variable bills", () => {
    render(
      <BillSuggestionAmountDisplay
        row={{ amount_min: "82.15", amount_avg: "95.40", amount_max: "110.05" }}
      />,
    )
    expect(screen.getByText("95.40")).toBeTruthy()
    expect(screen.getByText("82.15 - 110.05")).toBeTruthy()
  })
})
