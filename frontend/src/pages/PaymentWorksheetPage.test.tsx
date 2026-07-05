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
  bills: { owed: "0.00", due: "0.00", planned_cash: "0.00" },
  liabilities: { owed: "0.00", due: "0.00", planned_cash: "0.00" },
  credit_cards: { planned_cash: "0.00" },
}

const EMPTY_GRAND_TOTALS = { owed: "0.00", due: "0.00", planned_cash: "0.00" }

const EMPTY_ENVELOPE: PaymentWorksheetEnvelope = {
  month: "2026-07",
  refreshed_at: null,
  buckets: [],
  credit_cards: [],
  excluded_credit_cards: [],
  bills: [],
  liabilities: [],
  excluded_liabilities: [],
  bill_groups: [],
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
  bill_groups: [],
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

function makeBillRow(
  id: number,
  label: string,
  paid: boolean,
): PaymentWorksheetEnvelope["bills"][number] {
  return {
    registry_id: id,
    row_key: `bill:${id}`,
    row_label: label,
    firefly_bill_id: `ff-${id}`,
    amount_due: "50.00",
    amount_due_override: false,
    planned_amount: "50.00",
    planned_amount_override: false,
    paid_at: paid ? "2026-07-01T12:00:00Z" : null,
    payment_rail: "bank",
    counts_toward_cash_plan: true,
    funding_bucket_key: "checking",
    credit_card_account_id: null,
    amount_mode: "recurring",
    worksheet_section: "bills",
    bill_group_id: null,
    show_in_group: true,
  }
}

const BILLS_LIABILITIES_ENVELOPE: PaymentWorksheetEnvelope = {
  ...WORKSHEET_ENVELOPE,
  bills: [
    makeBillRow(1, "Electric", true),
    makeBillRow(2, "Water", true),
    makeBillRow(3, "Internet", false),
    makeBillRow(4, "Gym", false),
  ],
  liabilities: [
    {
      account_id: "loan-1",
      row_key: "liability:loan-1",
      name: "Mortgage",
      owed: "250000.00",
      amount_due: "1800.00",
      amount_due_override: false,
      est_interest: "800.00",
      remaining_payments: 142,
      planned_amount: "1800.00",
      planned_amount_override: false,
      paid_at: "2026-07-02T12:00:00Z",
      funding_bucket_key: "checking",
      default_planned_payment: "1800.00",
    },
    {
      account_id: "loan-2",
      row_key: "liability:loan-2",
      name: "Car loan",
      owed: "12000.00",
      amount_due: "350.00",
      amount_due_override: false,
      est_interest: "45.00",
      remaining_payments: 36,
      planned_amount: "350.00",
      planned_amount_override: false,
      paid_at: null,
      funding_bucket_key: "checking",
      default_planned_payment: "350.00",
    },
    {
      registry_id: 10,
      row_key: "bill:10",
      row_label: "Rent",
      amount_due: "1500.00",
      amount_due_override: false,
      planned_amount: "1500.00",
      planned_amount_override: false,
      paid_at: null,
      est_interest: null,
      remaining_payments: null,
      funding_bucket_key: "checking",
      payment_rail: "bank",
      counts_toward_cash_plan: true,
      amount_mode: "recurring",
    },
  ],
  section_subtotals: {
    bills: { owed: "0.00", due: "200.00", planned_cash: "200.00" },
    liabilities: { owed: "262000.00", due: "3650.00", planned_cash: "3650.00" },
    credit_cards: { planned_cash: "900.00" },
  },
  grand_totals: {
    owed: "264000.00",
    due: "3850.00",
    planned_cash: "4750.00",
  },
}

const GROUPED_BILLS_ENVELOPE: PaymentWorksheetEnvelope = {
  ...WORKSHEET_ENVELOPE,
  bills: [
    makeBillRow(1, "Electric", false),
    {
      ...makeBillRow(2, "Water", true),
      bill_group_id: "utilities",
      show_in_group: true,
    },
    {
      ...makeBillRow(3, "Gas", false),
      bill_group_id: "utilities",
      show_in_group: true,
    },
  ],
  bill_groups: [
    {
      id: "utilities",
      label: "Utilities",
      sort_order: 0,
      member_count: 2,
      visible_count: 2,
    },
  ],
  section_subtotals: {
    ...EMPTY_SECTION_SUBTOTALS,
    bills: { owed: "0.00", due: "150.00", planned_cash: "150.00" },
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

  it("empty-bucket state points to Cash accounts hub", async () => {
    mockPaymentFetch({ envelope: EMPTY_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      const bar = screen.getByTestId("funding-bucket-bar")
      expect(bar.textContent).toMatch(/No cash accounts — add them in/i)
      expect(
        bar.querySelector('a[href="/manage/payment-run/buckets"]'),
      ).toBeTruthy()
    })
    expect(screen.queryByRole("button", { name: "Add cash account" })).toBeNull()
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

    const chaseLinks = screen.getAllByRole("link", { name: /Chase VISA/i })
    const fireflyLink = chaseLinks.find(
      (link) => link.getAttribute("href") === "https://ff.example/accounts/show/42",
    )
    expect(fireflyLink).toBeTruthy()
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
      expect(screen.getByText("Shortfall in cash accounts")).toBeTruthy()
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
        screen.getByRole("link", { name: "Manage cards (1 excluded)" }),
      ).toBeTruthy()
      expect(
        screen.getByRole("button", { name: "Credit card table help" }),
      ).toBeTruthy()
      expect(
        screen.queryByText(/Card names open Firefly/i),
      ).toBeNull()
    })
  })

  it("renders bills and liabilities sections with paid-progress headers", async () => {
    mockPaymentFetch({ envelope: BILLS_LIABILITIES_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Bills · 2 / 4 paid")).toBeTruthy()
      expect(screen.getByText("Liabilities · 1 / 3 paid")).toBeTruthy()
      expect(screen.getByText("Electric")).toBeTruthy()
      expect(screen.getByText("Mortgage")).toBeTruthy()
      expect(screen.getByText("Rent")).toBeTruthy()
    })
  })

  it("renders expandable bill group parent from bill_groups envelope", async () => {
    mockPaymentFetch({ envelope: GROUPED_BILLS_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Expand Utilities bills" }),
      ).toBeTruthy()
      expect(screen.getByText("Utilities")).toBeTruthy()
    })
  })

  it("renders grand total footer with owed, due, and planned cash", async () => {
    mockPaymentFetch({ envelope: BILLS_LIABILITIES_ENVELOPE })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("grand-total-owed").textContent).toBe("264,000.00")
      expect(screen.getByTestId("grand-total-due").textContent).toBe("3,850.00")
      expect(screen.getByTestId("grand-total-planned-cash").textContent).toBe(
        "4,750.00",
      )
    })
  })

  it("places shortfall banner after grand total", async () => {
    mockPaymentFetch({
      envelope: { ...BILLS_LIABILITIES_ENVELOPE, shortfall: true },
    })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      const grandTotal = screen.getByTestId("worksheet-grand-total")
      const shortfall = screen.getByText("Shortfall in cash accounts")
      expect(
        grandTotal.compareDocumentPosition(shortfall) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })
  })

  it("shows Find bills cross-link when payment worksheet is enabled", async () => {
    mockPaymentFetch({ envelope: EMPTY_ENVELOPE, paymentEnabled: true })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      const link = screen.getByRole("link", { name: "Find bills →" })
      expect(link.getAttribute("href")).toBe("/manage/payment-run/discover")
    })
  })

  it("hides Find bills cross-link when payment worksheet is disabled", async () => {
    mockPaymentFetch({ envelope: EMPTY_ENVELOPE, paymentEnabled: false })

    render(
      <TestProviders>
        <PaymentWorksheetPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Find bills →" })).toBeNull()
    })
  })
})
