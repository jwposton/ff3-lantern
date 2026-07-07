import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { LiabilityDetailPage } from "./LiabilityDetailPage"

vi.mock("@/components/payment-run/LiabilityActivityChart", () => ({
  LiabilityActivityChart: () => <div>Payments by month</div>,
}))

function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/manage/liabilities/42"]}>
        <Routes>
          <Route path="/manage/liabilities/:accountId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockLiabilityDetailFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes("/health")) {
      return new Response(
        JSON.stringify({ status: "ok", payment_worksheet_enabled: true }),
        { status: 200 },
      )
    }
    if (url.includes("/api/loans")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              account_id: "42",
              configured: true,
              profile: { match: { expected_amount: "427.18" } },
            },
          ],
        }),
        { status: 200 },
      )
    }
    if (url.includes("/api/payment-run/liabilities/42/history")) {
      return new Response(
        JSON.stringify({
          account: {
            account_id: "42",
            name: "Mortgage",
            owed: "50000.00",
            est_interest: "250.00",
            funding_bucket_key: "checking",
            loan_configured: true,
          },
          window: { start: "2025-07-01", end: "2026-07-06" },
          stats_window: { start: "2025-07", end: "2026-07" },
          totals: {
            principal: "300.00",
            interest: "127.18",
            total_payment: "427.18",
          },
          monthly: [
            {
              month: "2026-07",
              principal: "150.00",
              interest: "63.59",
              escrow: "0.00",
              total_payment: "213.59",
            },
          ],
          transactions: [
            {
              journal_id: "500",
              date: "2026-07-10",
              description: "Mortgage July",
              amount: "427.18",
              principal: "300.00",
              interest: "127.18",
              escrow: "0.00",
            },
          ],
        }),
        { status: 200 },
      )
    }
    if (url.includes("/api/payment-run?")) {
      return new Response(
        JSON.stringify({
          month: "2026-07",
          buckets: [{ id: "checking", label: "Checking" }],
          credit_cards: [],
          excluded_credit_cards: [],
          bills: [],
          liabilities: [
            {
              account_id: "42",
              row_key: "liab:42",
              name: "Mortgage",
              owed: "50000.00",
              est_interest: "250.00",
              remaining_payments: null,
              funding_bucket_key: "checking",
              default_planned_payment: "427.18",
              planned_amount: "427.18",
              planned_amount_override: false,
              amount_due: "427.18",
              amount_due_override: false,
              paid_at: null,
            },
          ],
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

describe("LiabilityDetailPage", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders principal/interest KPIs, chart, and payment table", async () => {
    mockLiabilityDetailFetch()

    render(
      <TestProviders>
        <LiabilityDetailPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Mortgage" })).toBeTruthy()
      expect(screen.getAllByText("Principal").length).toBeGreaterThan(0)
      expect(screen.getAllByText("300.00").length).toBeGreaterThan(0)
      expect(screen.getByText("Payments by month")).toBeTruthy()
      expect(screen.getByText("Mortgage July")).toBeTruthy()
    })

    const loanProfileLink = screen.getByRole("link", { name: "Loan profile" })
    expect(loanProfileLink.getAttribute("href")).toBe("/manage/loans/42")
  })
})
