import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PaymentWorksheetPage } from "./PaymentWorksheetPage"
import type { PaymentWorksheetEnvelope } from "@/lib/paymentRunApi"

const EMPTY_SECTION_SUBTOTALS = {
  bills: { owed: "0.00", planned_cash: "0.00" },
  liabilities: { owed: "0.00", planned_cash: "0.00" },
  credit_cards: { planned_cash: "0.00" },
}

const EMPTY_GRAND_TOTALS = { owed: "0.00", planned_cash: "0.00" }

const EMPTY_ENVELOPE: PaymentWorksheetEnvelope = {
  month: "2026-07",
  refreshed_at: null,
  buckets: [],
  credit_cards: [],
  excluded_credit_cards: [],
  bills: [],
  liabilities: [],
  excluded_liabilities: [],
  section_subtotals: EMPTY_SECTION_SUBTOTALS,
  grand_totals: EMPTY_GRAND_TOTALS,
  shortfall: false,
  totals: {
    reported_balance: "0.00",
    user_balance: "0.00",
    remaining: "0.00",
  },
}

const WORKSHEET_ENVELOPE: PaymentWorksheetEnvelope = {
  month: "2026-07",
  refreshed_at: "2026-07-03T12:00:00Z",
  buckets: [
    {
      id: "checking",
      label: "Checking",
      sort_order: 0,
      reported_balance: "5000.00",
      user_balance: "5000.00",
      user_balance_override: false,
      planned_outflows: "900.00",
      remaining: "4100.00",
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
      new_transactions: [
        {
          journal_id: "301",
          date: "2026-07-10",
          description: "Grocery Store",
          payee: "Grocery Store",
          category: "Groceries",
          budget: "Groceries",
          kind: "charge",
          amount: "75.00",
        },
        {
          journal_id: "302",
          date: "2026-07-12",
          description: "Interest",
          payee: "Interest",
          category: "Credit Card Interest",
          budget: null,
          kind: "interest",
          amount: "20.00",
        },
        {
          journal_id: "303",
          date: "2026-07-14",
          description: "Late Fee",
          payee: "Late Fee",
          category: "Late Fee(s)",
          budget: null,
          kind: "fee",
          amount: "5.00",
        },
      ],
      planned_amount: "400.00",
      planned_amount_override: false,
      paid_at: null,
    },
    {
      account_id: "43",
      row_key: "cc:43",
      name: "AmEx",
      credit_limit: "5000.00",
      funding_bucket_key: "checking",
      default_planned_payment: null,
      payment_due_day: null,
      apr_percent: null,
      owed: "800.00",
      new_total: "50.00",
      interest_accrued: "10.00",
      fees: "0.00",
      last_payment_date: null,
      last_payment_amount: "0.00",
      new_transactions: [],
      planned_amount: "500.00",
      planned_amount_override: false,
      paid_at: "2026-07-15T12:00:00Z",
    },
  ],
  shortfall: false,
  excluded_credit_cards: [],
  bills: [],
  liabilities: [],
  excluded_liabilities: [],
  section_subtotals: EMPTY_SECTION_SUBTOTALS,
  grand_totals: EMPTY_GRAND_TOTALS,
  firefly_base_url: "https://ff.example",
  totals: {
    reported_balance: "5000.00",
    user_balance: "5000.00",
    remaining: "4100.00",
  },
}

const SHORTFALL_ENVELOPE: PaymentWorksheetEnvelope = {
  ...WORKSHEET_ENVELOPE,
  shortfall: true,
  buckets: [
    {
      ...WORKSHEET_ENVELOPE.buckets[0],
      remaining: "-100.00",
    },
  ],
  totals: {
    ...WORKSHEET_ENVELOPE.totals,
    remaining: "-100.00",
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

  it("renders bucket bar and credit card rows from mock envelope", async () => {
    mockPaymentFetch({ envelope: WORKSHEET_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("funding-bucket-bar")).toBeTruthy()
      expect(screen.getByText("Chase VISA")).toBeTruthy()
      expect(screen.getByText("AmEx")).toBeTruthy()
    })

    const chaseLink = screen.getByRole("link", { name: /Chase VISA/i })
    expect(chaseLink.getAttribute("href")).toBe(
      "https://ff.example/accounts/show/42",
    )
  })

  it("applies paid row styling with data-state=paid", async () => {
    mockPaymentFetch({ envelope: WORKSHEET_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      const paidRow = screen.getByText("AmEx").closest("tr")
      expect(paidRow?.getAttribute("data-state")).toBe("paid")
    })
  })

  it("shows shortfall banner when envelope shortfall is true", async () => {
    mockPaymentFetch({ envelope: SHORTFALL_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Shortfall in funding buckets")).toBeTruthy()
    })
  })

  it("subtotal includes paid row planned amount", async () => {
    mockPaymentFetch({ envelope: WORKSHEET_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("cc-planned-subtotal").textContent).toBe("900.00")
    })
  })

  it("mark paid does not reduce bucket remaining in fixture", async () => {
    mockPaymentFetch({ envelope: WORKSHEET_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      const bar = screen.getByTestId("funding-bucket-bar")
      expect(bar.textContent).toContain("4,100.00")
    })
  })

  it("shows manage cards with excluded count and help tooltip", async () => {
    mockPaymentFetch({
      envelope: {
        ...WORKSHEET_ENVELOPE,
        excluded_credit_cards: [
          { account_id: "99", name: "Hidden Card" },
        ],
      },
    })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Manage cards (1 excluded)" }),
      ).toBeTruthy()
      expect(
        screen.getByRole("button", { name: "Credit card table help" }),
      ).toBeTruthy()
      expect(
        screen.queryByText(/Card names open Firefly/i),
      ).toBeNull()
    })
  })
})
