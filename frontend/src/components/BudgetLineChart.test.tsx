import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TrendLineSeries } from "@/lib/barChart"
import { TOTAL_LABEL } from "@/lib/barChart"

import { BudgetLineChart } from "./BudgetLineChart"

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

const sampleSeries: TrendLineSeries[] = [
  { name: "Groceries", data: [100, 80] },
  { name: "Transport", data: [50, 20] },
  { name: TOTAL_LABEL, data: [150, 100], dashed: true },
]

const sampleProps = {
  months: ["2026-01", "2026-02"],
  series: sampleSeries,
  loading: false,
  emptyMessage: "No data",
  chartTitle: "Spending trends",
  yAxisName: "Spending",
}

describe("BudgetLineChart", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    capturedOption = null
    capturedOnEvents = null
  })

  it("enables legend interaction with triggerEvent true", () => {
    render(<BudgetLineChart {...sampleProps} onSelect={() => {}} />)

    const legend = capturedOption?.legend as Record<string, unknown>
    expect(legend?.triggerEvent).toBe(true)
    expect(legend?.selectedMode).not.toBe(false)
  })

  it("registers legendselectchanged handler for legend drill", () => {
    render(<BudgetLineChart {...sampleProps} onSelect={() => {}} />)

    expect(capturedOnEvents?.legendselectchanged).toBeTypeOf("function")
  })

  it("calls onSelect when legend item is selected via legendselectchanged", () => {
    const onSelect = vi.fn()
    render(<BudgetLineChart {...sampleProps} onSelect={onSelect} />)

    capturedOnEvents?.legendselectchanged?.({ name: "Groceries" })

    expect(onSelect).toHaveBeenCalledWith("Groceries")
  })

  it("calls onSelect when line point is clicked with budget seriesName", () => {
    const onSelect = vi.fn()
    render(<BudgetLineChart {...sampleProps} onSelect={onSelect} />)

    capturedOnEvents?.click?.({ seriesName: "Transport" })

    expect(onSelect).toHaveBeenCalledWith("Transport")
  })

  it("does not call onSelect when Total legend item is selected", () => {
    const onSelect = vi.fn()
    render(<BudgetLineChart {...sampleProps} onSelect={onSelect} />)

    capturedOnEvents?.legendselectchanged?.({ name: TOTAL_LABEL })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it("does not call onSelect when Total series point is clicked", () => {
    const onSelect = vi.fn()
    render(<BudgetLineChart {...sampleProps} onSelect={onSelect} />)

    capturedOnEvents?.click?.({ seriesName: TOTAL_LABEL })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it("keeps the same onEvents object reference on rerender with same props", () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <BudgetLineChart {...sampleProps} onSelect={onSelect} />,
    )

    const firstOnEvents = capturedOnEvents

    rerender(<BudgetLineChart {...sampleProps} onSelect={onSelect} />)

    expect(capturedOnEvents).toBe(firstOnEvents)
  })

  it("renders chartTitle and yAxisName props", () => {
    render(<BudgetLineChart {...sampleProps} onSelect={() => {}} />)

    expect(screen.getByText("Spending trends")).toBeTruthy()
    const yAxis = capturedOption?.yAxis as Record<string, unknown>
    expect(yAxis?.name).toBe("Spending")
  })
})
