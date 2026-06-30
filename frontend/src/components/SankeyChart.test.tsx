import { cleanup, render, screen } from "@testing-library/react"
import { afterEach } from "vitest"
import { describe, expect, it, vi } from "vitest"

import type { SankeyData } from "@/lib/sankey"

import { SankeyChart } from "./SankeyChart"

vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="echarts-mock" />,
}))

const sampleData: SankeyData = {
  nodes: [
    { name: "Bank Account (T)", displayName: "Bank Accounts" },
    { name: "Main Checking (A)", displayName: "Main Checking" },
  ],
  links: [
    {
      source: "Bank Account (T)",
      target: "Main Checking (A)",
      value: 100,
    },
  ],
}

describe("SankeyChart", () => {
  afterEach(() => cleanup())

  it("renders sankey-chart testid when data is present", () => {
    render(
      <SankeyChart
        data={sampleData}
        loading={false}
        emptyMessage="No data"
        chartTitle="Money flow"
      />,
    )

    expect(screen.getByTestId("sankey-chart")).toBeTruthy()
    expect(screen.getByTestId("echarts-mock")).toBeTruthy()
  })

  it("shows empty message when nodes are empty", () => {
    render(
      <SankeyChart
        data={{ nodes: [], links: [] }}
        loading={false}
        emptyMessage="No spending in this date range"
      />,
    )

    expect(screen.getByText("No spending in this date range")).toBeTruthy()
    expect(screen.queryByTestId("sankey-chart")).toBeNull()
  })
})
