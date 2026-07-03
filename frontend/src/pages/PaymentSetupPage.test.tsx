import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PaymentSetupPage } from "./PaymentSetupPage"
import type { PaymentWorksheetEnvelope } from "@/lib/paymentRunApi"

const EMPTY_SECTION_SUBTOTALS = {
  bills: { owed: "0.00", planned_cash: "0.00" },
  liabilities: { owed: "0.00", planned_cash: "0.00" },
  credit_cards: { planned_cash: "0.00" },
}

const EMPTY_GRAND_TOTALS = { owed: "0.00", planned_cash: "0.00" }

const SETUP_ENVELOPE: PaymentWorksheetEnvelope = {
  month: "2026-07",
  refreshed_at: "2026-07-03T12:00:00Z",
  buckets: [
    {
      id: "checking",
      label: "Checking",
      sort_order: 0,
      firefly_account_ids: ["1"],
      reported_balance: "5000.00",
      user_balance: "5000.00",
      user_balance_override: false,
      planned_outflows: "200.00",
      remaining: "4800.00",
    },
  ],
  credit_cards: [
    {
      account_id: "42",
      row_key: "cc:42",
      name: "Chase VISA",
      credit_limit: "10000.00",
      funding_bucket_key: "checking",
      default_planned_payment: "200.00",
      payment_due_day: "15",
      apr_percent: "24.99",
      owed: "1200.00",
      new_total: "100.00",
      interest_accrued: "20.00",
      fees: "5.00",
      last_payment_date: null,
      last_payment_amount: "0.00",
      new_transactions: [],
      planned_amount: "400.00",
      planned_amount_override: false,
      paid_at: null,
    },
  ],
  excluded_credit_cards: [],
  bills: [
    {
      registry_id: 1,
      row_key: "bill:1",
      row_label: "Electric",
      firefly_bill_id: "ff-1",
      owed: "50.00",
      planned_amount: "50.00",
      planned_amount_override: false,
      paid_at: null,
      payment_rail: "bank",
      counts_toward_cash_plan: true,
      funding_bucket_key: "checking",
      credit_card_account_id: null,
      amount_mode: "recurring",
      worksheet_section: "bills",
    },
  ],
  liabilities: [
    {
      account_id: "loan-1",
      row_key: "liability:loan-1",
      name: "Mortgage",
      owed: "250000.00",
      est_interest: "800.00",
      remaining_payments: 142,
      planned_amount: "1800.00",
      planned_amount_override: false,
      paid_at: null,
      funding_bucket_key: "checking",
      default_planned_payment: "1800.00",
    },
  ],
  excluded_liabilities: [],
  section_subtotals: EMPTY_SECTION_SUBTOTALS,
  grand_totals: EMPTY_GRAND_TOTALS,
  shortfall: false,
  totals: {
    reported_balance: "5000.00",
    user_balance: "5000.00",
    remaining: "4800.00",
  },
}

function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DateRangeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </DateRangeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockSetupFetch(options: {
  envelope?: PaymentWorksheetEnvelope
  paymentEnabled?: boolean
  availableBills?: { id: string; name: string | null }[]
}) {
  const envelope = options.envelope ?? SETUP_ENVELOPE
  const paymentEnabled = options.paymentEnabled ?? true
  const availableBills = options.availableBills ?? [
    { id: "ff-99", name: "Spotify" },
  ]

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

    if (url.includes("/api/payment-run?") && method === "GET") {
      return new Response(JSON.stringify(envelope), { status: 200 })
    }

    if (url.includes("/api/payment-run/available") && method === "GET") {
      return new Response(JSON.stringify({ data: availableBills }), {
        status: 200,
      })
    }

    if (url.includes("/api/payment-run/bills/1") && method === "DELETE") {
      return new Response(null, { status: 204 })
    }

    if (url.includes("/api/loans/meta")) {
      return new Response(
        JSON.stringify({
          liability_accounts: [],
          expense_accounts: [],
          asset_accounts: [
            { id: "1", name: "Main Checking", type: "asset", role: "defaultAsset" },
          ],
          categories: [],
          budgets: [],
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

  it("renders Payment setup heading and Back to worksheet link", async () => {
    mockSetupFetch({})

    render(
      <TestProviders>
        <PaymentSetupPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Payment setup" }),
      ).toBeTruthy()
      expect(screen.getByRole("link", { name: "Back to worksheet" }).getAttribute(
        "href",
      )).toBe("/manage/payment-run")
    })
  })

  it("renders five stacked sections when data is loaded", async () => {
    mockSetupFetch({})

    render(
      <TestProviders>
        <PaymentSetupPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("setup-funding-buckets")).toBeTruthy()
      expect(screen.getByTestId("setup-registered-bills")).toBeTruthy()
      expect(screen.getByTestId("setup-available-bills")).toBeTruthy()
      expect(screen.getByTestId("setup-credit-cards")).toBeTruthy()
      expect(screen.getByTestId("setup-liabilities")).toBeTruthy()
      expect(screen.getByText("Electric")).toBeTruthy()
      expect(screen.getByText("Spotify")).toBeTruthy()
      expect(screen.getByText(/1 card on the worksheet/)).toBeTruthy()
      expect(screen.getByText("Mortgage")).toBeTruthy()
    })
  })

  it("shows confirmation before removing a registered bill", async () => {
    const fetchSpy = mockSetupFetch({})

    render(
      <TestProviders>
        <PaymentSetupPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Electric")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Remove Electric" }))

    expect(
      screen.getByText("Remove Electric from worksheet?"),
    ).toBeTruthy()
    expect(
      screen.getByText("The Firefly bill and rule are not deleted."),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Remove" }))

    await waitFor(() => {
      const deleteCalls = fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/api/payment-run/bills/1") &&
          (init?.method ?? "GET") === "DELETE",
      )
      expect(deleteCalls).toHaveLength(1)
    })
  })
})
