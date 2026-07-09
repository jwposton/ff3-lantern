import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import {
  currentMonthKey,
  externalLinksQueryKey,
} from "@/lib/paymentRunApi"
import { paymentRunQueryKey } from "@/hooks/usePaymentWorksheet"

import { PaymentBucketsPage } from "./PaymentBucketsPage"

let testQueryClient: QueryClient

function TestProviders({ children }: { children: ReactNode }) {
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={testQueryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

function mockBucketsPageFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"

    if (url.includes("/health")) {
      return new Response(
        JSON.stringify({ status: "ok", payment_worksheet_enabled: true }),
        { status: 200 },
      )
    }

    if (url.includes("/api/loans/meta")) {
      return new Response(
        JSON.stringify({
          asset_accounts: [
            { id: "acct-1", name: "Main Checking", type: "asset", role: null },
          ],
          liability_accounts: [],
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/external-links")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "chase-login",
              label: "Chase",
              url: "https://chase.com",
              dependents: { total: 0 },
            },
          ],
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/buckets") && method === "GET") {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "checking",
              label: "Checking",
              sort_order: 0,
              firefly_account_ids: ["acct-1"],
              external_link_id: null,
            },
          ],
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/buckets/checking") && method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}"))
      return new Response(
        JSON.stringify({
          id: "checking",
          label: body.label ?? "Checking",
          sort_order: body.sort_order ?? 0,
          firefly_account_ids: body.firefly_account_ids ?? ["acct-1"],
          external_link_id: body.external_link_id ?? null,
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run?")) {
      return new Response(
        JSON.stringify({
          month: currentMonthKey(),
          buckets: [
            {
              id: "checking",
              label: "Checking",
              sort_order: 0,
              reported_balance: "5000.00",
              user_balance: "5000.00",
              user_balance_override: false,
              planned_outflows: "0.00",
              remaining: "5000.00",
              firefly_account_ids: ["acct-1"],
            },
          ],
          credit_cards: [],
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
            owed: "0",
            due: { cash: "0", credit: "0" },
            planned: { cash: "0", credit: "0" },
          },
          shortfall: false,
          totals: {
            reported_balance: "5000.00",
            user_balance: "5000.00",
            remaining: "5000.00",
          },
        }),
        { status: 200 },
      )
    }

    return new Response("not found", { status: 404 })
  })
}

describe("PaymentBucketsPage", () => {
  beforeEach(() => {
    testQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("invalidates externalLinksQueryKey after bucket save with external link", async () => {
    mockBucketsPageFetch()

    render(
      <TestProviders>
        <PaymentBucketsPage />
      </TestProviders>,
    )

    const invalidateSpy = vi.spyOn(testQueryClient, "invalidateQueries")

    await waitFor(() => {
      expect(screen.getByText("Checking")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Edit Checking" }))

    await waitFor(() => {
      expect(screen.getByTestId("external-link-select")).toBeTruthy()
    })

    fireEvent.change(screen.getByTestId("external-link-select"), {
      target: { value: "chase-login" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    const month = currentMonthKey()

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: paymentRunQueryKey(month),
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: externalLinksQueryKey(),
      })
    })
  })
})
