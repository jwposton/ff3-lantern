import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { PaymentSetupPage } from "./PaymentSetupPage"

function RedirectHarness({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/manage/payment-run/setup"]}>
      <Routes>
        <Route path="/manage/payment-run/setup" element={<PaymentSetupPage />} />
        <Route path="/manage/payment-run" element={children} />
      </Routes>
    </MemoryRouter>
  )
}

describe("PaymentSetupPage", () => {
  afterEach(() => {
    cleanup()
  })

  it("redirects legacy setup URL to worksheet with configure query", async () => {
    render(
      <RedirectHarness>
        <div data-testid="worksheet-landing">worksheet</div>
      </RedirectHarness>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("worksheet-landing")).toBeTruthy()
    })
  })
})
