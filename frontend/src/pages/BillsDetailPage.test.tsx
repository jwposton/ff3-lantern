import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { BillsDetailPage } from "./BillsDetailPage"
import type {
  BillHistoryEnvelope,
  PaymentWorksheetEnvelope,
  RegisteredBillListItem,
} from "@/lib/paymentRunApi"

const EMPTY_WORKSHEET: PaymentWorksheetEnvelope = {
  month: "2026-07",
  refreshed_at: null,
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
    },
  ],
  credit_cards: [],
  excluded_credit_cards: [],
  bills: [],
  liabilities: [],
  excluded_liabilities: [],
  bill_groups: [],
  section_subtotals: {
    bills: { owed: "0.00", due: "0.00", planned_cash: "0.00" },
    liabilities: { owed: "0.00", due: "0.00", planned_cash: "0.00" },
    credit_cards: { planned_cash: "0.00" },
  },
  grand_totals: { owed: "0.00", due: "0.00", planned_cash: "0.00" },
  shortfall: false,
  totals: {
    reported_balance: "5000.00",
    user_balance: "5000.00",
    remaining: "5000.00",
  },
}

const HEALTH_ENABLED = {
  status: "ok",
  firefly_base_url_configured: true,
  firefly_api_token_configured: true,
  openrouter_configured: false,
  sidecar_writable: true,
  payment_worksheet_enabled: true,
}

const BILL_ALPHA: RegisteredBillListItem = {
  registry_id: 1,
  row_label: "Internet",
  firefly_bill_id: "11",
  worksheet_section: "bills",
  payment_rail: "cash",
  amount_mode: "auto",
}

const BILL_BETA: RegisteredBillListItem = {
  registry_id: 2,
  row_label: "Electric",
  firefly_bill_id: "10",
  worksheet_section: "bills",
  payment_rail: "cash",
  amount_mode: "auto",
}

const BILL_CC: RegisteredBillListItem = {
  registry_id: 3,
  row_label: "Visa Payment",
  firefly_bill_id: "12",
  worksheet_section: "bills",
  payment_rail: "credit_card",
  amount_mode: "auto",
}

const MOCK_HISTORY: BillHistoryEnvelope = {
  registry_id: 1,
  row_label: "Internet",
  firefly_bill_id: "11",
  firefly_base_url: "https://firefly.example.com",
  window: { start: "2025-08-01", end: "2026-07-03" },
  total: "1200.00",
  calendar_average: "100.00",
  active_month_average: "600.00",
  active_month_count: 2,
  monthly_totals: [],
  transactions: [
    {
      journal_id: "501",
      date: "2026-06-15",
      description: "Monthly internet",
      payee: "ISP Co",
      amount: "79.99",
    },
    {
      journal_id: "502",
      date: "2026-05-15",
      description: "Monthly internet",
      payee: null,
      amount: "79.99",
    },
  ],
}

function TestProviders({
  children,
  initialEntry = "/manage/bills/1",
}: {
  children: ReactNode
  initialEntry?: string
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/manage/bills" element={children} />
          <Route path="/manage/bills/:registryId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockFetch(options: {
  bills?: RegisteredBillListItem[]
  history?: BillHistoryEnvelope | null
  historyStatus?: number
  worksheet?: PaymentWorksheetEnvelope
  availableBills?: { id: string; name: string }[]
}) {
  const bills = options.bills ?? [BILL_ALPHA, BILL_BETA]
  const worksheet = options.worksheet ?? EMPTY_WORKSHEET
  const availableBills = options.availableBills ?? [
    { id: "99", name: "Trash service" },
  ]
  let billsFetchCalls = 0
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url.includes("/health")) {
      return new Response(JSON.stringify(HEALTH_ENABLED), { status: 200 })
    }
    if (url.includes("/api/categorize/meta")) {
      return new Response(JSON.stringify({ categories: [], budgets: [] }), {
        status: 200,
      })
    }
    if (url.includes("/api/payment-run?") && !url.includes("bill-suggestions")) {
      return new Response(JSON.stringify(worksheet), { status: 200 })
    }
    if (url.includes("/api/payment-run/available")) {
      return new Response(JSON.stringify({ data: availableBills }), { status: 200 })
    }
    if (url.includes("/api/payment-run/bills/register") && method === "POST") {
      return new Response(
        JSON.stringify({
          id: 42,
          firefly_bill_id: "99",
          worksheet_section: "bills",
          funding_bucket_key: "checking",
          amount_mode: "recurring",
          planned_sync: "auto",
          payment_rail: "bank",
          counts_toward_cash_plan: true,
          rule_id: "1",
          row_label: "Trash service",
          credit_card_account_id: null,
        }),
        { status: 200 },
      )
    }
    if (url.match(/\/api\/payment-run\/bills\/\d+\/history/)) {
      if (options.historyStatus && options.historyStatus >= 400) {
        return new Response("not found", { status: options.historyStatus })
      }
      return new Response(JSON.stringify(options.history ?? MOCK_HISTORY), {
        status: 200,
      })
    }
    if (url.includes("/api/payment-run/bills") && !url.includes("/history")) {
      billsFetchCalls += 1
      return new Response(JSON.stringify({ data: bills }), { status: 200 })
    }
    return new Response("not found", { status: 404 })
  })
  return { fetchSpy, getBillsFetchCalls: () => billsFetchCalls }
}

describe("BillsDetailPage picker", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders Bill history title and bill names in picker", async () => {
    mockFetch({ bills: [BILL_ALPHA, BILL_BETA, BILL_CC] })
    render(
      <TestProviders initialEntry="/manage/bills/1">
        <BillsDetailPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Bill history" })).toBeTruthy()
      expect(screen.getByText("Internet")).toBeTruthy()
    })

    expect(screen.getByText("Electric")).toBeTruthy()
    expect(screen.getByText("Visa Payment")).toBeTruthy()
  })

  it("redirects /manage/bills to first bill by row_label sort", async () => {
    mockFetch({ bills: [BILL_BETA, BILL_ALPHA] })
    render(
      <TestProviders initialEntry="/manage/bills">
        <BillsDetailPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Internet")).toBeTruthy()
    })
  })

  it("empty picker offers link and register actions plus discover link", async () => {
    mockFetch({ bills: [] })
    render(
      <TestProviders initialEntry="/manage/bills">
        <BillsDetailPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("No bills registered yet")).toBeTruthy()
    })

    expect(screen.getAllByRole("button", { name: "Link existing bill" }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: "Register new bill" }).length).toBeGreaterThan(0)
    expect(
      screen.getByRole("link", { name: "find recurring bills" }).getAttribute("href"),
    ).toBe("/manage/payment-run/discover")
  })

  it("opens registration sheet in link mode from header", async () => {
    mockFetch({ bills: [BILL_ALPHA] })
    render(
      <TestProviders initialEntry="/manage/bills/1">
        <BillsDetailPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Link existing bill" })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Link existing bill" }))

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Register a bill" })).toBeTruthy()
    })

    expect(screen.getByRole("button", { name: "Link existing", pressed: true })).toBeTruthy()
  })

  it("shows inline error for invalid registry id while picker stays usable", async () => {
    mockFetch({ bills: [BILL_ALPHA] })
    render(
      <TestProviders initialEntry="/manage/bills/999">
        <BillsDetailPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getByText(/no longer registered or was removed from Firefly/i),
      ).toBeTruthy()
    })

    expect(screen.getByText("Internet")).toBeTruthy()
  })
})

describe("BillsDetailPage stats and table", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows stat labels and Firefly deep link on description", async () => {
    mockFetch({ bills: [BILL_ALPHA], history: MOCK_HISTORY })
    render(
      <TestProviders initialEntry="/manage/bills/1">
        <BillsDetailPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("12-month total")).toBeTruthy()
    })

    expect(screen.getByText("Calendar average")).toBeTruthy()
    expect(screen.getByText("Active-month average")).toBeTruthy()

    const txnLinks = screen.getAllByRole("link", { name: "Monthly internet" })
    expect(txnLinks[0]?.getAttribute("href")).toContain("/transactions/show/501")
  })

  it("header Refresh button refetches registered bills list", async () => {
    const { getBillsFetchCalls } = mockFetch({ bills: [BILL_ALPHA, BILL_BETA] })
    render(
      <TestProviders initialEntry="/manage/bills/1">
        <BillsDetailPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy()
    })
    expect(getBillsFetchCalls()).toBe(1)

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))

    expect(screen.queryByRole("button", { name: "Refreshing…" })).toBeNull()

    await waitFor(() => {
      expect(getBillsFetchCalls()).toBe(2)
    })
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy()
  })

  it("empty history renders empty table copy not error card", async () => {
    mockFetch({
      bills: [BILL_ALPHA],
      history: {
        ...MOCK_HISTORY,
        total: "0.00",
        calendar_average: "0.00",
        active_month_average: "0.00",
        active_month_count: 0,
        transactions: [],
      },
    })
    render(
      <TestProviders initialEntry="/manage/bills/1">
        <BillsDetailPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("No payments in this period")).toBeTruthy()
    })

    expect(
      screen.queryByText("Could not load bill history. Try again."),
    ).toBeNull()
  })
})
