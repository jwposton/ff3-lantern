import { describe, expect, it } from "vitest"

import {
  buildChartNavPath,
  detectReportLens,
  swapReportLensPath,
} from "./reportLens"

describe("detectReportLens", () => {
  it("returns cash-flow for cash-flow chart routes", () => {
    expect(detectReportLens("/reports/cash-flow")).toBe("cash-flow")
    expect(detectReportLens("/reports/cash-flow/sankey")).toBe("cash-flow")
  })

  it("defaults to spending for spending and non-chart routes", () => {
    expect(detectReportLens("/reports/spending")).toBe("spending")
    expect(detectReportLens("/reports/spending/mom")).toBe("spending")
    expect(detectReportLens("/")).toBe("spending")
    expect(detectReportLens("/manage/categorize")).toBe("spending")
  })
})

describe("buildChartNavPath", () => {
  it("builds paths for each lens and chart suffix", () => {
    expect(buildChartNavPath("spending", "")).toBe("/reports/spending")
    expect(buildChartNavPath("cash-flow", "/trends")).toBe(
      "/reports/cash-flow/trends",
    )
  })
})

describe("swapReportLensPath", () => {
  it("preserves chart suffix when switching lenses", () => {
    expect(swapReportLensPath("/reports/spending/sankey", "cash-flow")).toBe(
      "/reports/cash-flow/sankey",
    )
    expect(swapReportLensPath("/reports/cash-flow/mom", "spending")).toBe(
      "/reports/spending/mom",
    )
  })

  it("returns bar chart root when not on a chart route", () => {
    expect(swapReportLensPath("/", "cash-flow")).toBe("/reports/cash-flow")
    expect(swapReportLensPath("/manage/categorize", "spending")).toBe(
      "/reports/spending",
    )
  })
})
