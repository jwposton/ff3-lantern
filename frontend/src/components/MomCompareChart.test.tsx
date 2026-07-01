import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { compareChartHeight, MomCompareChart } from "./MomCompareChart"

let capturedOption: Record<string, unknown> | null = null

vi.mock("echarts-for-react", () => ({
  default: ({
    option,
    "data-testid": testId,
    style,
  }: {
    option: Record<string, unknown>
    "data-testid"?: string
    style?: { height?: number }
  }) => {
    capturedOption = option
    return (
      <div data-testid={testId ?? "echarts-mock"} data-height={style?.height} />
    )
  },
}))

const sampleDeltas = new Map([
  ["Groceries", 120],
  ["Transport", -45],
])

const sampleProps = {
  sortedNames: ["Groceries", "Transport"],
  deltas: sampleDeltas,
  loading: false,
  emptyMessage: "No spending in this date range",
  chartTitle: "Month-over-month spending change",
  yAxisName: "Δ spending",
}

describe("MomCompareChart", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    capturedOption = null
  })

  it("renders data-testid mom-compare-chart when sortedNames non-empty", () => {
    render(<MomCompareChart {...sampleProps} />)

    expect(screen.getByTestId("mom-compare-chart")).toBeTruthy()
  })

  it("uses horizontal bar with inverse category yAxis", () => {
    render(<MomCompareChart {...sampleProps} />)

    const yAxis = capturedOption?.yAxis as Record<string, unknown>
    expect(yAxis?.type).toBe("category")
    expect(yAxis?.inverse).toBe(true)
    expect(yAxis?.data).toEqual(["Groceries", "Transport"])

    const xAxis = capturedOption?.xAxis as Record<string, unknown>
    expect(xAxis?.type).toBe("value")
  })

  it("applies semantic red/green bar colors by delta sign", () => {
    render(<MomCompareChart {...sampleProps} />)

    const series = capturedOption?.series as Array<{
      data?: Array<{ itemStyle?: { color?: string } }>
    }>
    const barData = series?.[0]?.data
    expect(barData?.[0]?.itemStyle?.color).toBe("#ef4444")
    expect(barData?.[1]?.itemStyle?.color).toBe("#22c55e")
  })

  it("uses item trigger tooltip", () => {
    render(<MomCompareChart {...sampleProps} />)

    const tooltip = capturedOption?.tooltip as Record<string, unknown>
    expect(tooltip?.trigger).toBe("item")
  })

  it("shows empty message when sortedNames is empty", () => {
    render(
      <MomCompareChart
        {...sampleProps}
        sortedNames={[]}
        deltas={new Map()}
      />,
    )

    expect(screen.queryByTestId("mom-compare-chart")).toBeNull()
    expect(screen.getByText("No spending in this date range")).toBeTruthy()
  })
})

describe("compareChartHeight", () => {
  it("returns 480 for 12 or fewer rows", () => {
    expect(compareChartHeight(12)).toBe(480)
    expect(compareChartHeight(5)).toBe(480)
  })

  it("adds 28px per row above 12 up to 720 max", () => {
    expect(compareChartHeight(13)).toBe(508)
    expect(compareChartHeight(20)).toBe(704)
    expect(compareChartHeight(30)).toBe(720)
  })
})
