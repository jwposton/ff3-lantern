import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CurrentVsBaseline } from "@/lib/momVariance"

let capturedOnEvents: Record<string, (params: unknown) => void> | null = null

vi.mock("echarts-for-react", () => ({
  default: ({
    onEvents,
  }: {
    onEvents?: Record<string, (params: unknown) => void>
  }) => {
    capturedOnEvents = onEvents ?? null
    return <div data-testid="echarts-mock" />
  },
}))

import { BudgetCurrentVsAverageChart } from "@/components/BudgetCurrentVsAverageChart"

const values = new Map<string, CurrentVsBaseline>([
  ["Groceries", { current: 120, baseline: 100 }],
  ["Transport", { current: 40, baseline: 35 }],
])

describe("BudgetCurrentVsAverageChart", () => {
  beforeEach(() => {
    capturedOnEvents = null
  })

  it("calls onSelect when a budget row is clicked", () => {
    const onSelect = vi.fn()
    render(
      <BudgetCurrentVsAverageChart
        sortedNames={["Groceries", "Transport"]}
        values={values}
        loading={false}
        emptyMessage="No data"
        onSelect={onSelect}
      />,
    )

    capturedOnEvents?.click?.({ name: "Groceries" })
    expect(onSelect).toHaveBeenCalledWith("Groceries")
  })

  it("does not register click events without onSelect", () => {
    render(
      <BudgetCurrentVsAverageChart
        sortedNames={["Groceries", "Transport"]}
        values={values}
        loading={false}
        emptyMessage="No data"
      />,
    )

    expect(capturedOnEvents).toBeNull()
  })
})
