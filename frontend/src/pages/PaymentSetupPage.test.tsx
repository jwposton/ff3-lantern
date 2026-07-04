import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { PaymentSetupPage } from "./PaymentSetupPage"

function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

function mockSetupFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)

    if (url.includes("/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          payment_worksheet_enabled: true,
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/bills") && !url.includes("history")) {
      return new Response(
        JSON.stringify({
          data: [{ registry_id: 1, row_label: "Electric" }],
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/available")) {
      return new Response(
        JSON.stringify({ data: [{ id: "ff-1", name: "Internet" }] }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run?")) {
      return new Response(
        JSON.stringify({
          month: "2026-07",
          buckets: [{ id: "checking", label: "Checking" }],
          credit_cards: [{ account_id: "1" }],
          excluded_credit_cards: [{ account_id: "2", name: "Hidden" }],
          liabilities: [
            { account_id: "10", registry_id: null },
            { registry_id: 5, account_id: null },
          ],
          excluded_liabilities: [{ account_id: "11", name: "Old loan" }],
        }),
        { status: 200 },
      )
    }

    return new Response("not found", { status: 404 })
  })
}

describe("PaymentSetupPage", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders overview cards with live counts and manage links", async () => {
    mockSetupFetch()

    render(
      <TestProviders>
        <PaymentSetupPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Payment setup" }),
      ).toBeTruthy()
      expect(screen.getByText("1 registered · 1 available to link")).toBeTruthy()
      expect(screen.getByText("1 funding bucket")).toBeTruthy()
      expect(screen.getByText("1 on worksheet · 1 excluded")).toBeTruthy()
      expect(screen.getByText("1 accounts · 1 excluded")).toBeTruthy()
    })

    const manageLinks = screen.getAllByRole("link", { name: /Manage/i })
    expect(manageLinks[0].getAttribute("href")).toBe("/manage/bills")
    expect(manageLinks[1].getAttribute("href")).toBe("/manage/payment-run/buckets")
    expect(manageLinks[2].getAttribute("href")).toBe("/manage/payment-run/cards")
    expect(manageLinks[3].getAttribute("href")).toBe("/manage/liabilities")
    expect(screen.getByRole("link", { name: "Find bills" }).getAttribute("href")).toBe(
      "/manage/payment-run/discover",
    )
    expect(
      screen.getByRole("link", { name: "Open worksheet" }).getAttribute("href"),
    ).toBe("/manage/payment-run")
  })
})
