import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { PaymentSetupPage } from "./PaymentSetupPage"

function TestProviders({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/manage/payment-run/setup"]}>{children}</MemoryRouter>
}

describe("PaymentSetupPage", () => {
  afterEach(() => {
    cleanup()
  })

  it("redirects to the bill pay worksheet", () => {
    render(
      <TestProviders>
        <Routes>
          <Route path="/manage/payment-run/setup" element={<PaymentSetupPage />} />
          <Route
            path="/manage/payment-run"
            element={<div>Bill Pay Worksheet</div>}
          />
        </Routes>
      </TestProviders>,
    )

    expect(screen.getByText("Bill Pay Worksheet")).toBeTruthy()
  })
})
