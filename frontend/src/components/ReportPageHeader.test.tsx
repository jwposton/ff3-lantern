import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"

import { ReportPageHeader } from "./ReportPageHeader"

function LocationEcho() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

function renderHeader(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/reports/spending/*"
          element={
            <>
              <ReportPageHeader title="Spending" />
              <LocationEcho />
            </>
          }
        />
        <Route
          path="/reports/cash-flow/*"
          element={
            <>
              <ReportPageHeader title="Cash Flow" />
              <LocationEcho />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe("ReportPageHeader", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders title and report lens toggle", () => {
    renderHeader("/reports/spending")
    expect(screen.getByRole("heading", { name: "Spending" })).toBeTruthy()
    expect(screen.getByRole("group", { name: "Report lens" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Spending" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Cash Flow" })).toBeTruthy()
  })

  it("navigates to cash-flow while preserving chart suffix", () => {
    renderHeader("/reports/spending/sankey")
    const lens = screen.getByRole("group", { name: "Report lens" })
    fireEvent.click(within(lens).getByRole("button", { name: "Cash Flow" }))
    expect(screen.getByTestId("pathname").textContent).toBe(
      "/reports/cash-flow/sankey",
    )
  })

  it("navigates to spending while preserving chart suffix", () => {
    renderHeader("/reports/cash-flow/trends")
    const lens = screen.getByRole("group", { name: "Report lens" })
    fireEvent.click(within(lens).getByRole("button", { name: "Spending" }))
    expect(screen.getByTestId("pathname").textContent).toBe(
      "/reports/spending/trends",
    )
  })
})
