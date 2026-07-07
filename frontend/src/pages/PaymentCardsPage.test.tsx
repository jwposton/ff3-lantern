import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { PaymentCardsPage } from "./PaymentCardsPage"

function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/manage/payment-run/cards"]}>
        <DateRangeProvider>
          <Routes>
            <Route path="/manage/payment-run/cards" element={children} />
            <Route
              path="/manage/payment-run/cards/:accountId"
              element={<div>Card detail</div>}
            />
          </Routes>
        </DateRangeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockCardsPageFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes("/health")) {
      return new Response(
        JSON.stringify({ status: "ok", payment_worksheet_enabled: true }),
        { status: 200 },
      )
    }
    if (url.includes("/api/payment-run/credit-cards/3/history")) {
      return new Response(
        JSON.stringify({
          account: {
            account_id: "3",
            name: "Chase VISA",
            owed: "1250.50",
            apr_percent: "19.99",
            credit_limit: "10000.00",
            payment_due_day: "15",
            funding_bucket_key: "checking",
          },
          window: { start: "2025-07-01", end: "2026-07-06" },
          stats_window: { start: "2025-07", end: "2026-07" },
          totals: {
            charges: "89.99",
            fees: "35.00",
            interest: "24.50",
            payments: "500.00",
          },
          monthly: [],
          transactions: [],
        }),
        { status: 200 },
      )
    }
    if (url.includes("/api/payment-run?")) {
      return new Response(
        JSON.stringify({
          month: "2026-07",
          buckets: [{ id: "checking", label: "Checking" }],
          credit_cards: [
            {
              account_id: "3",
              row_key: "cc:3",
              name: "Chase VISA",
              owed: "1250.50",
              apr_percent: "19.99",
              funding_bucket_key: "checking",
              credit_limit: "10000.00",
              default_planned_payment: "200.00",
              payment_due_day: "15",
              new_total: "0.00",
              interest_accrued: "0.00",
              fees: "0.00",
              last_payment_date: null,
              last_payment_amount: "0.00",
              new_transactions: [],
              planned_amount: "200.00",
              planned_amount_override: false,
              paid_at: null,
            },
          ],
          excluded_credit_cards: [],
          bills: [],
          liabilities: [],
          excluded_liabilities: [],
          bill_groups: [],
          section_subtotals: {
            bills: { owed: "0", due: "0", planned_cash: "0" },
            liabilities: { owed: "0", due: "0", planned_cash: "0" },
            credit_cards: { planned_cash: "0" },
          },
          grand_totals: {
            owed: { liabilities: "0", revolving: "0" },
            due: { cash: "0", credit: "0" },
            planned: {
              cash: "0",
              credit: "0",
              liabilities: { cash: { due: "0", planned: "0" }, credit: { due: "0", planned: "0" } },
              credit_card_pmts: { cash: { due: "0", planned: "0" }, credit: { due: "0", planned: "0" } },
            },
          },
          shortfall: false,
          totals: {
            reported_balance: "0",
            user_balance: "0",
            remaining: "0",
          },
        }),
        { status: 200 },
      )
    }
    return new Response("not found", { status: 404 })
  })
}

describe("PaymentCardsPage", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders portfolio KPIs and card rows with balance and APR", async () => {
    mockCardsPageFetch()

    render(
      <TestProviders>
        <PaymentCardsPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Total balance")).toBeTruthy()
      expect(screen.getByText("1,250.50")).toBeTruthy()
      expect(screen.getByText("89.99")).toBeTruthy()
      expect(screen.getByText("Chase VISA")).toBeTruthy()
      expect(screen.getByText(/APR 19\.99%/)).toBeTruthy()
    })

    const viewLink = screen.getByRole("link", { name: "View" })
    expect(viewLink.getAttribute("href")).toBe("/manage/payment-run/cards/3")
  })
})
