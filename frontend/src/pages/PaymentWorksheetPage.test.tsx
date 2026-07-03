import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { PaymentWorksheetPage } from "./PaymentWorksheetPage"
import type { PaymentWorksheetEnvelope } from "@/lib/paymentRunApi"

const EMPTY_ENVELOPE: PaymentWorksheetEnvelope = {
  month: "2026-07",
  refreshed_at: null,
  buckets: [],
  credit_cards: [],
  shortfall: false,
  totals: {
    reported_balance: "0.00",
    user_balance: "0.00",
    remaining: "0.00",
  },
}

function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DateRangeProvider>{children}</DateRangeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockPaymentFetch(options: {
  envelope?: PaymentWorksheetEnvelope
  paymentEnabled?: boolean
}) {
  const envelope = options.envelope ?? EMPTY_ENVELOPE
  const paymentEnabled = options.paymentEnabled ?? true

  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"

    if (url.includes("/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          firefly_base_url_configured: true,
          firefly_api_token_configured: true,
          openrouter_configured: false,
          sidecar_writable: true,
          payment_worksheet_enabled: paymentEnabled,
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/refresh") && method === "POST") {
      return new Response(
        JSON.stringify({ month: envelope.month, refreshed_at: "2026-07-03T12:00:00Z" }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run?") && method === "GET") {
      return new Response(JSON.stringify(envelope), { status: 200 })
    }

    if (url.includes("/api/loans/meta")) {
      return new Response(
        JSON.stringify({
          liability_accounts: [],
          expense_accounts: [],
          asset_accounts: [],
          categories: [],
          budgets: [],
        }),
        { status: 200 },
      )
    }

    return new Response("not found", { status: 404 })
  })
}

describe("PaymentWorksheetPage", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("GET-only load does not call refresh on mount", async () => {
    const fetchSpy = mockPaymentFetch({ envelope: EMPTY_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Payment Worksheet" })).toBeTruthy()
    })

    const refreshCalls = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        String(url).includes("/api/payment-run/refresh") &&
        (init?.method ?? "GET") === "POST",
    )
    expect(refreshCalls).toHaveLength(0)

    const getCalls = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        String(url).includes("/api/payment-run?") && (init?.method ?? "GET") === "GET",
    )
    expect(getCalls.length).toBeGreaterThan(0)
  })

  it("empty-bucket state shows Add funding bucket CTA", async () => {
    mockPaymentFetch({ envelope: EMPTY_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add funding bucket" })).toBeTruthy()
    })
  })
})
