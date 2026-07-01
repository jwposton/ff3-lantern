import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  pieLegendLabel,
  pieSegmentLabel,
  PIE_LABEL_MIN_PERCENT,
  slicePercentMap,
} from "@/components/BudgetSpendPieChart"

let capturedOption: Record<string, unknown> | null = null
let capturedOnEvents: Record<string, (params: unknown) => void> | null = null

vi.mock("echarts-for-react", () => ({
  default: ({
    option,
    onEvents,
  }: {
    option: Record<string, unknown>
    onEvents?: Record<string, (params: unknown) => void>
  }) => {
    capturedOption = option
    capturedOnEvents = onEvents ?? null
    return <div data-testid="echarts-mock" />
  },
}))

import { BudgetSpendPieChart } from "@/components/BudgetSpendPieChart"

const sampleSlices = [
  { name: "Groceries", value: 120 },
  { name: "Transport", value: 30 },
  { name: "Misc", value: 10 },
]

describe("pieSegmentLabel", () => {
  it("shows name and percent when slice is large enough", () => {
    expect(pieSegmentLabel("Groceries", 12.4)).toBe("Groceries\n12.4%")
  })

  it("hides label for small slices", () => {
    expect(pieSegmentLabel("Misc", 3.2)).toBe("")
  })

  it("shows label at the minimum threshold", () => {
    expect(pieSegmentLabel("Transport", PIE_LABEL_MIN_PERCENT)).toBe(
      "Transport\n5.0%",
    )
  })

  it("truncates long budget names", () => {
    expect(
      pieSegmentLabel("Very Long Budget Name Here", 10),
    ).toBe("Very Long Budget…\n10.0%")
  })
})

describe("pieLegendLabel", () => {
  it("shows truncated name and percent", () => {
    expect(pieLegendLabel("Groceries", 75.0)).toBe("Groceries  75.0%")
  })
})

describe("slicePercentMap", () => {
  it("computes share for each slice", () => {
    const map = slicePercentMap(sampleSlices)
    expect(map.get("Groceries")).toBeCloseTo(75)
    expect(map.get("Transport")).toBeCloseTo(18.75)
    expect(map.get("Misc")).toBeCloseTo(6.25)
  })
})

describe("BudgetSpendPieChart", () => {
  beforeEach(() => {
    capturedOption = null
    capturedOnEvents = null
  })

  it("renders a plain vertical legend with percent labels for all slices", () => {
    render(
      <BudgetSpendPieChart
        slices={sampleSlices}
        loading={false}
        emptyMessage="No data"
      />,
    )

    const legend = capturedOption?.legend as Record<string, unknown>
    expect(legend?.type).toBe("plain")
    expect(legend?.orient).toBe("vertical")
    expect(legend?.data).toEqual(["Groceries", "Transport", "Misc"])
    expect(legend?.formatter).toBeTypeOf("function")
    expect(
      (legend.formatter as (name: string) => string)("Groceries"),
    ).toBe("Groceries  75.0%")
  })

  it("calls onSliceSelect when a slice is clicked", () => {
    const onSliceSelect = vi.fn()
    render(
      <BudgetSpendPieChart
        slices={sampleSlices}
        loading={false}
        emptyMessage="No data"
        onSliceSelect={onSliceSelect}
      />,
    )

    capturedOnEvents?.click?.({ name: "Groceries" })
    expect(onSliceSelect).toHaveBeenCalledWith("Groceries")
  })

  it("does not register click events without onSliceSelect", () => {
    render(
      <BudgetSpendPieChart
        slices={sampleSlices}
        loading={false}
        emptyMessage="No data"
      />,
    )

    expect(capturedOnEvents).toBeNull()
  })

  it("shows empty state when there are no slices", () => {
    render(
      <BudgetSpendPieChart
        slices={[]}
        loading={false}
        emptyMessage="No spending in this date range"
      />,
    )

    expect(screen.getByText("No spending in this date range")).toBeTruthy()
  })
})
