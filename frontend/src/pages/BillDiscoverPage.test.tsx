import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { BillDiscoverPage } from "./BillDiscoverPage"
import { registeredBillsQueryKey } from "@/hooks/useBillHistory"
import {
  groupByPayee,
  orderedPayeeKeys,
} from "@/lib/billDiscoverUtils"
import type { BillSuggestionsEnvelope, BillSuggestion } from "@/lib/paymentRunApi"
import type { PaymentWorksheetEnvelope } from "@/lib/paymentRunApi"

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

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
  grand_totals: {
    owed: "0.00",
    due: "0.00",
    planned_cash: "0.00",
    planned_total: "0.00",
    breakdown: {
      owed: { liabilities: "0.00", revolving: "0.00" },
      due: { cash: "0.00", credit: "0.00" },
      planned: { cash: "0.00", credit: "0.00" },
      due_planned: {
        liabilities: {
          cash: { due: "0.00", planned: "0.00" },
          credit: { due: "0.00", planned: "0.00" },
        },
        bills: {
          cash: { due: "0.00", planned: "0.00" },
          credit: { due: "0.00", planned: "0.00" },
        },
        credit_card_pmts: {
          cash: { due: "0.00", planned: "0.00" },
          credit: { due: "0.00", planned: "0.00" },
        },
      },
    },
  },
  shortfall: false,
  totals: {
    reported_balance: "5000.00",
    user_balance: "5000.00",
    remaining: "5000.00",
  },
}

function makeSuggestion(
  overrides: Partial<BillSuggestion> & Pick<BillSuggestion, "id" | "merchant" | "bucket">,
): BillSuggestion {
  const payee = overrides.payee ?? overrides.bucket
  return {
    confidence: "high",
    status: "ready",
    amount_min: "9.99",
    amount_max: "10.99",
    amount_avg: "10.49",
    occurrences: 12,
    freq: "monthly",
    regularity: 0.95,
    last_date: "2026-06-15",
    first_date: "2025-06-15",
    category: "Streaming",
    payment_source: "Chase VISA",
    sample_descriptions: [],
    cluster: null,
    register_prefill: {
      mode: "create_new",
      name: overrides.merchant,
      destination_account: payee,
    },
    reasons: [],
    ...overrides,
    payee,
    bucket: overrides.bucket ?? payee,
  }
}

const MULTI_PAYEE_SUGGESTIONS: BillSuggestionsEnvelope = {
  data: [
    makeSuggestion({
      id: "spotify",
      merchant: "Spotify",
      payee: "Spotify USA Inc",
      bucket: "Spotify USA Inc",
      category: "Music Streaming",
      register_prefill: { mode: "create_new", name: "Spotify", destination_account: "Spotify USA Inc" },
    }),
    makeSuggestion({
      id: "netflix",
      merchant: "Netflix",
      payee: "Netflix Inc",
      bucket: "Netflix Inc",
      category: "Streaming",
    }),
    makeSuggestion({
      id: "electric",
      merchant: "City Electric",
      payee: "City Electric Co",
      bucket: "City Electric Co",
      category: "Utilities",
    }),
    makeSuggestion({
      id: "review-row",
      merchant: "Mystery Charge",
      payee: "Mystery Vendor",
      bucket: "Mystery Vendor",
      status: "review",
      confidence: "low",
      category: "Subscriptions",
    }),
  ],
  meta: {
    withdrawals_analyzed: 1384,
    suggestions_count: 4,
    period_start: "2025-07-01",
    period_end: "2026-07-04",
  },
}

const SUGGESTIONS_FIXTURE: BillSuggestionsEnvelope = {
  data: [],
  meta: {
    withdrawals_analyzed: 1384,
    suggestions_count: 49,
    period_start: "2025-07-01",
    period_end: "2026-07-04",
  },
}

const TXN_ENVELOPES: Record<
  string,
  { data: Array<{
    date: string
    amount: string
    description: string
    category: string | null
    payee: string | null
    budget: string | null
  }> }
> = {
  spotify: {
    data: [
      {
        date: "2026-06-15",
        amount: "10.99",
        description: "SPOTIFY USA CHARGE JUNE",
        category: "Music Streaming",
        payee: "Spotify USA Inc",
        budget: "Entertainment",
      },
      {
        date: "2026-05-15",
        amount: "10.99",
        description: "SPOTIFY USA CHARGE MAY",
        category: "Music Streaming",
        payee: "Spotify USA Inc",
        budget: "Entertainment",
      },
    ],
  },
  netflix: {
    data: [
      {
        date: "2026-06-10",
        amount: "15.49",
        description: "NETFLIX.COM MONTHLY",
        category: "Streaming",
        payee: "Netflix Inc",
        budget: "Entertainment",
      },
      {
        date: "2026-05-10",
        amount: "15.49",
        description: "NETFLIX.COM PRIOR MONTH",
        category: "Streaming",
        payee: "Netflix Inc",
        budget: "Entertainment",
      },
    ],
  },
}

function suggestionTransactionsUrl(url: string): string | null {
  const match = url.match(
    /\/api\/payment-run\/bill-suggestions\/([^/?]+)\/transactions/,
  )
  return match ? decodeURIComponent(match[1]) : null
}

function TestProviders({
  children,
  initialEntry = "/manage/payment-run/discover",
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
        <DateRangeProvider>
          <TooltipProvider>
            <Routes>
              <Route path="/" element={<div>Home page</div>} />
              <Route
                path="/manage/payment-run/discover"
                element={children}
              />
            </Routes>
          </TooltipProvider>
        </DateRangeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockDiscoverFetch(options: {
  paymentEnabled?: boolean
  suggestions?: BillSuggestionsEnvelope
  suggestionsStatus?: number
  delaySuggestions?: boolean
  worksheet?: PaymentWorksheetEnvelope
  transactionEnvelopes?: typeof TXN_ENVELOPES
}) {
  const paymentEnabled = options.paymentEnabled ?? true
  const suggestions = options.suggestions ?? SUGGESTIONS_FIXTURE
  const worksheet = options.worksheet ?? EMPTY_WORKSHEET
  const transactionEnvelopes = options.transactionEnvelopes ?? TXN_ENVELOPES
  let suggestionsCalls = 0
  let transactionCalls = 0
  let worksheetCalls = 0
  let registerCalls = 0
  let resolveSuggestions: (() => void) | null = null
  const suggestionsGate = options.delaySuggestions
    ? new Promise<void>((resolve) => {
        resolveSuggestions = resolve
      })
    : null

  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
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

    if (url.includes("/api/payment-run/discover-settings")) {
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body ?? "{}"))
        return new Response(
          JSON.stringify({
            ignored_categories: body.ignored_categories ?? ["Gas"],
            ignored_payees: body.ignored_payees ?? [],
          }),
          { status: 200 },
        )
      }
      if (url.includes("ignore-payee") && method === "POST") {
        return new Response(
          JSON.stringify({
            ignored_payees: ["Spotify USA Inc"],
            ignored_payee: "Spotify USA Inc",
          }),
          { status: 200 },
        )
      }
      if (url.includes("ignore-category") && method === "POST") {
        return new Response(
          JSON.stringify({
            ignored_categories: ["Streaming"],
            ignored_category: "Streaming",
          }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          ignored_categories: [],
          ignored_payees: [],
          available_categories: [
            { id: "1", name: "Gas" },
            { id: "2", name: "Rent" },
          ],
          suggested_ignored_categories: ["Gas", "Restaurants"],
        }),
        { status: 200 },
      )
    }

    const suggestionId = suggestionTransactionsUrl(url)
    if (suggestionId != null) {
      transactionCalls += 1
      const envelope = transactionEnvelopes[suggestionId] ?? { data: [] }
      return new Response(
        JSON.stringify({
          data: envelope.data,
          meta: {
            suggestion_id: suggestionId,
            transaction_count: envelope.data.length,
            period_start: "2025-07-01",
            period_end: "2026-07-04",
          },
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/bill-suggestions")) {
      suggestionsCalls += 1
      if (suggestionsGate) {
        await suggestionsGate
      }
      if (options.suggestionsStatus && options.suggestionsStatus >= 400) {
        return new Response(JSON.stringify({ detail: "upstream error" }), {
          status: options.suggestionsStatus,
        })
      }
      return new Response(JSON.stringify(suggestions), { status: 200 })
    }

    if (url.includes("/api/payment-run?") && !url.includes("bill-suggestions")) {
      worksheetCalls += 1
      return new Response(JSON.stringify(worksheet), { status: 200 })
    }

    if (url.includes("/api/payment-run/bills/register")) {
      registerCalls += 1
      return new Response(
        JSON.stringify({
          registry_id: 1,
          firefly_bill_id: "99",
          worksheet_section: "bills",
          row_label: "Spotify",
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/available")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
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

  return {
    fetchSpy,
    getSuggestionsCalls: () => suggestionsCalls,
    getTransactionCalls: () => transactionCalls,
    getWorksheetCalls: () => worksheetCalls,
    getRegisterCalls: () => registerCalls,
    getSuggestionUrls: () =>
      fetchSpy.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.includes("/api/payment-run/bill-suggestions")),
    getTransactionUrls: () =>
      fetchSpy.mock.calls
        .map(([input]) => String(input))
        .filter((url) => suggestionTransactionsUrl(url) != null),
    releaseSuggestions: () => resolveSuggestions?.(),
  }
}

describe("BillDiscoverPage", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("feature gate redirects when payment worksheet is disabled", async () => {
    mockDiscoverFetch({ paymentEnabled: false })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Home page")).toBeTruthy()
    })
    expect(screen.queryByRole("heading", { name: "Bill Discovery" })).toBeNull()
  })

  it("shows back link to payment worksheet", async () => {
    mockDiscoverFetch({})

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      const link = screen.getByRole("link", { name: "← Bill Pay Worksheet" })
      expect(link.getAttribute("href")).toBe("/manage/payment-run")
    })
  })

  it("lookback URL drives fetch lookback_months param", async () => {
    const { getSuggestionUrls } = mockDiscoverFetch({})

    render(
      <TestProviders initialEntry="/manage/payment-run/discover?lookback=24">
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Bill Discovery" })).toBeTruthy()
    })

    expect(getSuggestionUrls().some((url) => url.includes("lookback_months=24"))).toBe(true)
  })

  it("lookback coerces invalid URL value to 12 in fetch param", async () => {
    const { getSuggestionUrls } = mockDiscoverFetch({})

    render(
      <TestProviders initialEntry="/manage/payment-run/discover?lookback=99">
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Bill Discovery" })).toBeTruthy()
    })

    expect(getSuggestionUrls().some((url) => url.includes("lookback_months=12"))).toBe(true)
  })

  it("refresh triggers second fetch with same lookback", async () => {
    const { getSuggestionsCalls } = mockDiscoverFetch({})

    render(
      <TestProviders initialEntry="/manage/payment-run/discover?lookback=12">
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("1,384")).toBeTruthy()
    })
    expect(getSuggestionsCalls()).toBe(1)

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))

    await waitFor(() => {
      expect(getSuggestionsCalls()).toBe(2)
    })
  })

  it("meta bar shows withdrawals, period, and suggestion count", async () => {
    mockDiscoverFetch({})

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("1,384")).toBeTruthy()
    })
    expect(screen.getByText("Jul 2025")).toBeTruthy()
    expect(screen.getByText("0")).toBeTruthy()
  })

  it("hide review toggle updates visible suggestion count in meta bar", async () => {
    mockDiscoverFetch({ suggestions: MULTI_PAYEE_SUGGESTIONS })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("4")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Hide review" }))

    await waitFor(() => {
      expect(screen.getByText("3")).toBeTruthy()
    })
  })

  it("invalid lookback URL param is replaced in the address bar", async () => {
    mockDiscoverFetch({})

    render(
      <TestProviders initialEntry="/manage/payment-run/discover?lookback=99">
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Bill Discovery" })).toBeTruthy()
    })

    const lookbackSelect = screen.getByLabelText("Time frame") as HTMLSelectElement
    expect(lookbackSelect.value).toBe("12")
  })

  it("loading shows meta bar and bucket card skeletons", async () => {
    const { releaseSuggestions } = mockDiscoverFetch({ delaySuggestions: true })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Bill Discovery" })).toBeTruthy()
    })

    const busyRegion = screen.getByLabelText("Bill Discovery content")
    expect(busyRegion.getAttribute("aria-busy")).toBe("true")

    const skeletons = document.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThanOrEqual(4)

    releaseSuggestions()

    await waitFor(() => {
      expect(busyRegion.getAttribute("aria-busy")).toBeNull()
    })
  })

  it("error state shows retry copy and refetches on Try again", async () => {
    const { getSuggestionsCalls } = mockDiscoverFetch({
      suggestionsStatus: 502,
    })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getByText("Could not load bill suggestions."),
      ).toBeTruthy()
    })
    expect(getSuggestionsCalls()).toBe(1)

    fireEvent.click(screen.getByRole("button", { name: "Try again" }))

    await waitFor(() => {
      expect(getSuggestionsCalls()).toBe(2)
    })
  })

  it("opaque payee section renders alphabetically with other payees", async () => {
    const suggestions: BillSuggestionsEnvelope = {
      ...MULTI_PAYEE_SUGGESTIONS,
      data: [
        ...MULTI_PAYEE_SUGGESTIONS.data,
        makeSuggestion({
          id: "icloud",
          merchant: "Icloud+",
          payee: "APPLE.COM/BILL",
          bucket: "APPLE.COM/BILL",
          cluster: "apple-com-bill",
          register_prefill: {
            mode: "create_new",
            name: "Icloud+",
            destination_account: "APPLE.COM/BILL",
          },
        }),
      ],
      meta: {
        ...MULTI_PAYEE_SUGGESTIONS.meta,
        suggestions_count: 5,
      },
    }

    mockDiscoverFetch({ suggestions })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "APPLE.COM/BILL (1)" }),
      ).toBeTruthy()
    })

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((node) => node.textContent)
    const appleIdx = headings.findIndex((text) =>
      text?.startsWith("APPLE.COM/BILL"),
    )
    const spotifyIdx = headings.findIndex((text) =>
      text?.startsWith("Spotify USA Inc"),
    )
    expect(appleIdx).toBeGreaterThanOrEqual(0)
    expect(spotifyIdx).toBeGreaterThan(appleIdx)
  })

  it("orderedPayeeKeys sorts payee sections alphabetically", () => {
    const grouped = groupByPayee(
      [
        makeSuggestion({
          id: "paypal",
          merchant: "Hosting",
          payee: "PAYPAL *SERVICES",
          bucket: "PAYPAL *SERVICES",
        }),
        makeSuggestion({
          id: "apple",
          merchant: "Icloud+",
          payee: "APPLE.COM/BILL",
          bucket: "APPLE.COM/BILL",
        }),
        makeSuggestion({
          id: "tickets",
          merchant: "Season Pass",
          payee: "Ticketmaster",
          bucket: "Ticketmaster",
        }),
        makeSuggestion({
          id: "streaming",
          merchant: "Spotify",
          payee: "Spotify USA Inc",
          bucket: "Spotify USA Inc",
        }),
      ],
      false,
    )

    expect(orderedPayeeKeys(grouped)).toEqual([
      "APPLE.COM/BILL",
      "PAYPAL *SERVICES",
      "Spotify USA Inc",
      "Ticketmaster",
    ])
  })

  it("payee sections render and omit empty groups", async () => {
    mockDiscoverFetch({ suggestions: MULTI_PAYEE_SUGGESTIONS })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Spotify USA Inc (1)" })).toBeTruthy()
    })
    expect(screen.getByRole("heading", { name: "Netflix Inc (1)" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "City Electric Co (1)" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Mystery Vendor (1)" })).toBeTruthy()
  })

  it("hide review toggle filters review status rows", async () => {
    mockDiscoverFetch({ suggestions: MULTI_PAYEE_SUGGESTIONS })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getAllByText("Mystery Charge").length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole("button", { name: "Hide review" }))

    await waitFor(() => {
      expect(screen.queryAllByText("Mystery Charge")).toHaveLength(0)
    })
    expect(screen.getByRole("button", { name: "Showing all" })).toBeTruthy()
  })

  it("Adopt opens registration sheet with prefilled merchant name", async () => {
    mockDiscoverFetch({ suggestions: MULTI_PAYEE_SUGGESTIONS })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Adopt Spotify as bill" }).length,
      ).toBeGreaterThan(0)
    })

    fireEvent.click(
      screen.getAllByRole("button", { name: "Adopt Spotify as bill" })[0],
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Register a bill" })).toBeTruthy()
    })

    const nameInput = screen.getByLabelText("Bill name") as HTMLInputElement
    expect(nameInput.value).toBe("Spotify")
    expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull()
  })

  it("register refetches suggestions, invalidates worksheet, and shows toast", async () => {
    const {
      getSuggestionsCalls,
      getWorksheetCalls,
      getRegisterCalls,
    } = mockDiscoverFetch({ suggestions: MULTI_PAYEE_SUGGESTIONS })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/manage/payment-run/discover"]}>
          <DateRangeProvider>
            <TooltipProvider>
              <Routes>
                <Route path="/" element={<div>Home page</div>} />
                <Route
                  path="/manage/payment-run/discover"
                  element={<BillDiscoverPage />}
                />
              </Routes>
            </TooltipProvider>
          </DateRangeProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Adopt Spotify as bill" }).length,
      ).toBeGreaterThan(0)
    })
    expect(getSuggestionsCalls()).toBe(1)
    const worksheetCallsBeforeRegister = getWorksheetCalls()

    fireEvent.click(
      screen.getAllByRole("button", { name: "Adopt Spotify as bill" })[0],
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Register a bill" })).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText("Amount min"), {
      target: { value: "9.99" },
    })
    fireEvent.change(screen.getByLabelText("Amount max"), {
      target: { value: "10.99" },
    })
    fireEvent.change(screen.getByLabelText(/Rule — description contains/i), {
      target: { value: "SPOTIFY" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Register bill" }))

    await waitFor(() => {
      expect(getRegisterCalls()).toBe(1)
    })
    await waitFor(() => {
      expect(getSuggestionsCalls()).toBe(2)
      expect(getWorksheetCalls()).toBeGreaterThan(worksheetCallsBeforeRegister)
      expect(toastSuccess).toHaveBeenCalledWith("Spotify registered", {
        duration: 4000,
      })
    })
    await waitFor(() => {
      expect(
        invalidateSpy.mock.calls.some(
          ([args]) =>
            JSON.stringify(args?.queryKey) ===
            JSON.stringify(registeredBillsQueryKey()),
        ),
      ).toBe(true)
    })
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Register a bill" })).toBeNull()
    })
  })

  it("shows payee detail when cluster is set", async () => {
    mockDiscoverFetch({
      suggestions: {
        data: [
          makeSuggestion({
            id: "icloud",
            merchant: "Cloud Storage",
            payee: "APPLE.COM/BILL",
            bucket: "APPLE.COM/BILL",
            category: "Cloud Storage",
            cluster: "apple-com-bill",
            register_prefill: {
              mode: "create_new",
              name: "Cloud Storage",
              destination_account: "APPLE.COM/BILL",
            },
          }),
        ],
        meta: {
          withdrawals_analyzed: 100,
          suggestions_count: 1,
          period_start: "2025-07-01",
          period_end: "2026-07-04",
        },
      },
    })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getAllByText(/Payee: APPLE\.COM\/BILL/).length).toBeGreaterThan(0)
    })
  })

  it("cluster detail shows payee instead of legacy notes", async () => {
    mockDiscoverFetch({
      suggestions: {
        data: [
          makeSuggestion({
            id: "icloud",
            merchant: "Cloud Storage",
            payee: "APPLE.COM/BILL",
            bucket: "APPLE.COM/BILL",
            cluster: "apple-com-bill",
            notes: "Opaque payee warning should not show",
            register_prefill: {
              mode: "create_new",
              name: "Cloud Storage",
              destination_account: "APPLE.COM/BILL",
            },
          }),
        ],
        meta: {
          withdrawals_analyzed: 100,
          suggestions_count: 1,
          period_start: "2025-07-01",
          period_end: "2026-07-04",
        },
      },
    })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getAllByText(/Payee: APPLE\.COM\/BILL/).length).toBeGreaterThan(0)
    })
    expect(
      screen.queryByText("Opaque payee warning should not show"),
    ).toBeNull()
  })

  it("ready cluster rows skip amber review highlight", async () => {
    mockDiscoverFetch({
      suggestions: {
        data: [
          makeSuggestion({
            id: "icloud",
            merchant: "Cloud Storage",
            bucket: "APPLE.COM/BILL",
            cluster: "apple-com-bill",
            status: "ready",
            register_prefill: {
              mode: "create_new",
              name: "Cloud Storage",
              destination_account: "APPLE.COM/BILL",
            },
          }),
        ],
        meta: {
          withdrawals_analyzed: 100,
          suggestions_count: 1,
          period_start: "2025-07-01",
          period_end: "2026-07-04",
        },
      },
    })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getAllByText("Cloud Storage").length).toBeGreaterThan(0)
    })

    const highlighted = document.querySelectorAll(".border-l-amber-500\\/70")
    expect(highlighted.length).toBe(0)
  })

  it("review misc catch-all rows keep amber review highlight", async () => {
    mockDiscoverFetch({
      suggestions: {
        data: [
          makeSuggestion({
            id: "misc",
            merchant: "APPLE.COM/BILL (misc)",
            bucket: "APPLE.COM/BILL",
            cluster: "apple-com-bill",
            status: "review",
            register_prefill: {
              mode: "create_new",
              name: "APPLE.COM/BILL (misc)",
              destination_account: "APPLE.COM/BILL",
            },
          }),
        ],
        meta: {
          withdrawals_analyzed: 100,
          suggestions_count: 1,
          period_start: "2025-07-01",
          period_end: "2026-07-04",
        },
      },
    })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getAllByText("APPLE.COM/BILL (misc)").length).toBeGreaterThan(
        0,
      )
    })

    const highlighted = document.querySelectorAll(".border-l-amber-500\\/70")
    expect(highlighted.length).toBeGreaterThan(0)
  })

  it("empty state shows positive message with worksheet and bills links", async () => {
    mockDiscoverFetch({
      suggestions: {
        data: [],
        meta: {
          withdrawals_analyzed: 1384,
          suggestions_count: 0,
          period_start: "2025-07-01",
          period_end: "2026-07-04",
        },
      },
    })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("No new bill suggestions")).toBeTruthy()
    })
    expect(screen.getByText("1,384")).toBeTruthy()
    expect(screen.getByText("Jul 2025")).toBeTruthy()
    expect(screen.getByText("0")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Open payment worksheet" }).getAttribute(
        "href",
      ),
    ).toBe("/manage/payment-run")
    expect(
      screen.getByRole("link", { name: "View registered bills" }).getAttribute(
        "href",
      ),
    ).toBe("/manage/bills")
  })

  it("shows category column and ignore menu on suggestion rows", async () => {
    mockDiscoverFetch({
      suggestions: {
        data: [
          makeSuggestion({
            id: "spotify",
            merchant: "Spotify",
            payee: "Spotify USA Inc",
            bucket: "Spotify USA Inc",
            destination_name: "Spotify USA Inc",
            category: "Streaming",
          }),
        ],
        meta: {
          withdrawals_analyzed: 12,
          suggestions_count: 1,
          period_start: "2025-07-01",
          period_end: "2026-07-04",
        },
      },
    })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Cat.")).toBeTruthy()
      expect(screen.getByText("Streaming")).toBeTruthy()
      expect(
        screen.getAllByRole("button", { name: "Ignore options for Spotify" })
          .length,
      ).toBeGreaterThan(0)
    })
  })

  it("expand drill-down fetches transactions and shows mini-table rows", async () => {
    const { getTransactionUrls, getTransactionCalls } = mockDiscoverFetch({
      suggestions: MULTI_PAYEE_SUGGESTIONS,
    })

    render(
      <TestProviders initialEntry="/manage/payment-run/discover?lookback=12">
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", {
          name: "Show withdrawals for Spotify",
        }).length,
      ).toBeGreaterThan(0)
    })

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Show withdrawals for Spotify",
      })[0],
    )

    await waitFor(() => {
      expect(getTransactionCalls()).toBeGreaterThan(0)
    })
    expect(
      getTransactionUrls().some(
        (url) =>
          url.includes("/bill-suggestions/spotify/transactions") &&
          url.includes("lookback_months=12"),
      ),
    ).toBe(true)
    await waitFor(() => {
      expect(
        screen.getAllByText("SPOTIFY USA CHARGE JUNE").length,
      ).toBeGreaterThan(0)
    })
  })

  it("adopt drill-down expand does not open registration sheet", async () => {
    mockDiscoverFetch({ suggestions: MULTI_PAYEE_SUGGESTIONS })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", {
          name: "Show withdrawals for Spotify",
        }).length,
      ).toBeGreaterThan(0)
    })

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Show withdrawals for Spotify",
      })[0],
    )

    await waitFor(() => {
      expect(
        screen.getAllByText("SPOTIFY USA CHARGE JUNE").length,
      ).toBeGreaterThan(0)
    })
    expect(screen.queryByRole("heading", { name: "Register a bill" })).toBeNull()

    fireEvent.click(
      screen.getAllByRole("button", { name: "Adopt Spotify as bill" })[0],
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Register a bill" })).toBeTruthy()
    })
  })

  it("lookback change collapses expanded drill-down and clears txn cache", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const removeQueriesSpy = vi.spyOn(queryClient, "removeQueries")
    const { getTransactionCalls } = mockDiscoverFetch({
      suggestions: MULTI_PAYEE_SUGGESTIONS,
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/manage/payment-run/discover?lookback=12"]}>
          <DateRangeProvider>
            <TooltipProvider>
              <Routes>
                <Route path="/" element={<div>Home page</div>} />
                <Route
                  path="/manage/payment-run/discover"
                  element={<BillDiscoverPage />}
                />
              </Routes>
            </TooltipProvider>
          </DateRangeProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", {
          name: "Show withdrawals for Spotify",
        }).length,
      ).toBeGreaterThan(0)
    })

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Show withdrawals for Spotify",
      })[0],
    )

    await waitFor(() => {
      expect(
        screen.getAllByText("SPOTIFY USA CHARGE JUNE").length,
      ).toBeGreaterThan(0)
    })
    const txnCallsBeforeLookback = getTransactionCalls()

    const lookbackSelect = screen.getByLabelText("Time frame") as HTMLSelectElement
    fireEvent.change(lookbackSelect, { target: { value: "6" } })

    await waitFor(() => {
      expect(screen.queryAllByText("SPOTIFY USA CHARGE JUNE")).toHaveLength(0)
    })
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", {
          name: "Show withdrawals for Spotify",
        }).length,
      ).toBeGreaterThan(0)
    })
    expect(
      screen.getAllByRole("button", {
        name: "Show withdrawals for Spotify",
      })[0].getAttribute("aria-expanded"),
    ).toBe("false")
    expect(
      removeQueriesSpy.mock.calls.some(
        ([args]) =>
          JSON.stringify(args?.queryKey) ===
          JSON.stringify(["paymentRun", "billSuggestionTransactions"]),
      ),
    ).toBe(true)

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Show withdrawals for Spotify",
      })[0],
    )

    await waitFor(() => {
      expect(getTransactionCalls()).toBeGreaterThan(txnCallsBeforeLookback)
    })
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["paymentRun", "billSuggestionTransactions"] })
        .some((query) => String(query.queryKey).includes("6")),
    ).toBe(true)
  })

  it("keyboard expand toggles chevron aria-expanded on Enter", async () => {
    mockDiscoverFetch({ suggestions: MULTI_PAYEE_SUGGESTIONS })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", {
          name: "Show withdrawals for Spotify",
        }).length,
      ).toBeGreaterThan(0)
    })

    const chevron = screen.getAllByRole("button", {
      name: "Show withdrawals for Spotify",
    })[0]
    expect(chevron.getAttribute("aria-expanded")).toBe("false")
    chevron.focus()
    expect(document.activeElement).toBe(chevron)
    fireEvent.click(chevron)

    await waitFor(() => {
      expect(chevron.getAttribute("aria-expanded")).toBe("true")
    })
    await waitFor(() => {
      expect(
        screen.getAllByText("SPOTIFY USA CHARGE JUNE").length,
      ).toBeGreaterThan(0)
    })

    chevron.focus()
    fireEvent.click(chevron)

    await waitFor(() => {
      expect(chevron.getAttribute("aria-expanded")).toBe("false")
    })
  })

  it("multi_expand shows sibling drill-down panels simultaneously", async () => {
    mockDiscoverFetch({ suggestions: MULTI_PAYEE_SUGGESTIONS })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", {
          name: "Show withdrawals for Spotify",
        }).length,
      ).toBeGreaterThan(0)
    })

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Show withdrawals for Spotify",
      })[0],
    )
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Show withdrawals for Netflix",
      })[0],
    )

    await waitFor(() => {
      expect(
        screen.getAllByText("SPOTIFY USA CHARGE JUNE").length,
      ).toBeGreaterThan(0)
      expect(
        screen.getAllByText("NETFLIX.COM MONTHLY").length,
      ).toBeGreaterThan(0)
    })
    expect(
      screen.getAllByRole("region", { name: /Withdrawals for Spotify/ }).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByRole("region", { name: /Withdrawals for Netflix/ }).length,
    ).toBeGreaterThan(0)
  })
})
