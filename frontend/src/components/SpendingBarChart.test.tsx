import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BarChartData } from "@/lib/barChart"
import { INCOME_LINE_COLOR, INCOME_LINE_LABEL } from "@/lib/barChart"

import { SpendingBarChart } from "./SpendingBarChart"

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

const sampleChartData: BarChartData = {
  months: ["2026-01"],
  stacks: ["Groceries", "Transport"],
  data: {
    "2026-01": { Groceries: 100, Transport: 50 },
  },
}

describe("SpendingBarChart", () => {
  beforeEach(() => {
    capturedOption = null
    capturedOnEvents = null
  })

  it("enables legend interaction with triggerEvent true", () => {
    render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={() => {}}
      />,
    )

    const legend = capturedOption?.legend as Record<string, unknown>
    expect(legend?.orient).toBe("vertical")
    expect(legend?.right).toBe(4)
    expect(legend?.triggerEvent).toBe(true)
    expect(legend?.selectedMode).not.toBe(false)
  })

  it("reserves fixed right margin when legend labels are long", () => {
    const longLabelChart: BarChartData = {
      months: ["2026-01"],
      stacks: ["Whole Foods Market Downtown Location"],
      data: {
        "2026-01": { "Whole Foods Market Downtown Location": 100 },
      },
    }

    render(
      <SpendingBarChart
        chartData={longLabelChart}
        loading={false}
        emptyMessage="No data"
        onSelect={() => {}}
      />,
    )

    const grid = capturedOption?.grid as Record<string, unknown>
    expect(grid?.right).toBe(96)
    const legend = capturedOption?.legend as Record<string, unknown>
    expect(legend?.formatter).toBeTypeOf("function")
    expect(
      (legend.formatter as (name: string) => string)(
        "Whole Foods Market Downtown Location",
      ).endsWith("…"),
    ).toBe(true)
  })

  it("registers legendselectchanged handler for legend drill", () => {
    render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={() => {}}
      />,
    )

    expect(capturedOnEvents?.legendselectchanged).toBeTypeOf("function")
  })

  it("calls onSelect when legend item is selected via legendselectchanged", () => {
    const onSelect = vi.fn()
    render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={onSelect}
      />,
    )

    capturedOnEvents?.legendselectchanged?.({ name: "Groceries" })

    expect(onSelect).toHaveBeenCalledWith("Groceries")
  })

  it("calls onSelect when bar segment is clicked", () => {
    const onSelect = vi.fn()
    render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={onSelect}
      />,
    )

    capturedOnEvents?.click?.({ seriesName: "Groceries" })

    expect(onSelect).toHaveBeenCalledWith("Groceries")
  })

  it("keeps the same onEvents object reference on rerender with same props", () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={onSelect}
      />,
    )

    const firstOnEvents = capturedOnEvents

    rerender(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={onSelect}
      />,
    )

    expect(capturedOnEvents).toBe(firstOnEvents)
  })

  it("renders chartTitle and yAxisName props", () => {
    render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={() => {}}
        chartTitle="Cash outflow by month"
        yAxisName="Cash outflow"
      />,
    )

    expect(screen.getByText("Cash outflow by month")).toBeTruthy()
    const yAxis = capturedOption?.yAxis as Record<string, unknown>
    expect(yAxis?.name).toBe("Cash outflow")
  })

  it("adds emerald Income line series when monthlyIncome is provided", () => {
    render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={() => {}}
        monthlyIncome={[3000]}
      />,
    )

    const series = capturedOption?.series as Array<Record<string, unknown>>
    const incomeSeries = series.find((s) => s.name === INCOME_LINE_LABEL)
    expect(incomeSeries).toMatchObject({
      type: "line",
      data: [3000],
      lineStyle: { color: INCOME_LINE_COLOR, width: 2 },
    })
    expect(incomeSeries?.label).toBeUndefined()
  })

  it("uses item tooltip with income appended on bar hover when income line is enabled", () => {
    render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={() => {}}
        monthlyIncome={[3000]}
      />,
    )

    const tooltip = capturedOption?.tooltip as Record<string, unknown>
    expect(tooltip?.trigger).toBe("item")
    const formatter = tooltip.formatter as (params: unknown) => string
    const barHover = formatter({
      seriesName: "Groceries",
      name: "2026-01",
      value: 100,
      dataIndex: 0,
    })
    expect(barHover).toContain("Groceries: 100.00")
    expect(barHover).toContain("Income: 3,000.00")

    const incomeHover = formatter({
      seriesName: INCOME_LINE_LABEL,
      name: "2026-01",
      value: 3000,
      dataIndex: 0,
    })
    expect(incomeHover).toContain("Income: 3,000.00")
    expect(incomeHover).not.toContain("Groceries")
  })

  it("omits income series and uses item tooltip without monthlyIncome", () => {
    render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={() => {}}
      />,
    )

    const series = capturedOption?.series as Array<Record<string, unknown>>
    expect(series.some((s) => s.name === INCOME_LINE_LABEL)).toBe(false)
    const tooltip = capturedOption?.tooltip as Record<string, unknown>
    expect(tooltip?.trigger).toBe("item")
  })

  it("does not drill when Income legend item is toggled", async () => {
    const onSelect = vi.fn()
    render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={onSelect}
        monthlyIncome={[3000]}
      />,
    )

    capturedOnEvents?.legendselectchanged?.({
      name: INCOME_LINE_LABEL,
      selected: { [INCOME_LINE_LABEL]: false },
    })

    expect(onSelect).not.toHaveBeenCalled()

    await waitFor(() => {
      const tooltip = capturedOption?.tooltip as Record<string, unknown>
      const formatter = tooltip.formatter as (params: unknown) => string
      const barHover = formatter({
        seriesName: "Groceries",
        name: "2026-01",
        value: 100,
        dataIndex: 0,
      })
      expect(barHover).not.toContain("Income:")
    })
  })

  it("does not drill when Income line is clicked", () => {
    const onSelect = vi.fn()
    render(
      <SpendingBarChart
        chartData={sampleChartData}
        loading={false}
        emptyMessage="No data"
        onSelect={onSelect}
        monthlyIncome={[3000]}
      />,
    )

    capturedOnEvents?.click?.({ seriesName: INCOME_LINE_LABEL })

    expect(onSelect).not.toHaveBeenCalled()
  })
})
