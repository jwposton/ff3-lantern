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
  groupByBucket,
  orderedBucketKeys,
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

function makeSuggestion(
  overrides: Partial<BillSuggestion> & Pick<BillSuggestion, "id" | "merchant" | "bucket">,
): BillSuggestion {
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
    },
    reasons: [],
    ...overrides,
  }
}

const MULTI_BUCKET_SUGGESTIONS: BillSuggestionsEnvelope = {
  data: [
    makeSuggestion({
      id: "spotify",
      merchant: "Spotify",
      bucket: "Streaming & Media",
      register_prefill: { mode: "create_new", name: "Spotify" },
    }),
    makeSuggestion({
      id: "netflix",
      merchant: "Netflix",
      bucket: "Streaming & Media",
    }),
    makeSuggestion({
      id: "electric",
      merchant: "City Electric",
      bucket: "Utilities & Telecom",
    }),
    makeSuggestion({
      id: "review-row",
      merchant: "Mystery Charge",
      bucket: "Other Recurring",
      status: "review",
      confidence: "low",
    }),
  ],
  meta: {
    withdrawals_analyzed: 1384,
    suggestions_count: 4,
    period_start: "2025-07-04",
    period_end: "2026-07-04",
  },
}

const SUGGESTIONS_FIXTURE: BillSuggestionsEnvelope = {
  data: [],
  meta: {
    withdrawals_analyzed: 1384,
    suggestions_count: 49,
    period_start: "2025-07-04",
    period_end: "2026-07-04",
  },
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
}) {
  const paymentEnabled = options.paymentEnabled ?? true
  const suggestions = options.suggestions ?? SUGGESTIONS_FIXTURE
  const worksheet = options.worksheet ?? EMPTY_WORKSHEET
  let suggestionsCalls = 0
  let worksheetCalls = 0
  let registerCalls = 0
  let resolveSuggestions: (() => void) | null = null
  const suggestionsGate = options.delaySuggestions
    ? new Promise<void>((resolve) => {
        resolveSuggestions = resolve
      })
    : null

  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)

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
    getWorksheetCalls: () => worksheetCalls,
    getRegisterCalls: () => registerCalls,
    getSuggestionUrls: () =>
      fetchSpy.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.includes("/api/payment-run/bill-suggestions")),
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
    expect(screen.queryByRole("heading", { name: "Bill discover" })).toBeNull()
  })

  it("shows back link to payment worksheet", async () => {
    mockDiscoverFetch({})

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      const link = screen.getByRole("link", { name: "← Payment Worksheet" })
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
      expect(screen.getByRole("heading", { name: "Bill discover" })).toBeTruthy()
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
      expect(screen.getByRole("heading", { name: "Bill discover" })).toBeTruthy()
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
      expect(screen.getByText("1,384 withdrawals analyzed")).toBeTruthy()
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
      expect(screen.getByText("1,384 withdrawals analyzed")).toBeTruthy()
    })
    expect(screen.getByText(/Jul 2025 – Jul 4, 2026/)).toBeTruthy()
    expect(screen.getByText("0 suggestions")).toBeTruthy()
  })

  it("hide review toggle updates visible suggestion count in meta bar", async () => {
    mockDiscoverFetch({ suggestions: MULTI_BUCKET_SUGGESTIONS })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("4 suggestions")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Hide review" }))

    await waitFor(() => {
      expect(screen.getByText("3 suggestions")).toBeTruthy()
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
      expect(screen.getByRole("heading", { name: "Bill discover" })).toBeTruthy()
    })

    const lookbackSelect = screen.getByLabelText("Lookback") as HTMLSelectElement
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
      expect(screen.getByRole("heading", { name: "Bill discover" })).toBeTruthy()
    })

    const busyRegion = screen.getByLabelText("Bill discover content")
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

  it("dynamic_opaque_bucket_renders at opaque slot before later fixed buckets", async () => {
    const suggestions: BillSuggestionsEnvelope = {
      ...MULTI_BUCKET_SUGGESTIONS,
      data: [
        ...MULTI_BUCKET_SUGGESTIONS.data,
        makeSuggestion({
          id: "icloud",
          merchant: "Icloud+",
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
        ...MULTI_BUCKET_SUGGESTIONS.meta,
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
    const streamingIdx = headings.findIndex((text) =>
      text?.startsWith("Streaming & Media"),
    )
    const opaqueIdx = headings.findIndex((text) =>
      text?.startsWith("APPLE.COM/BILL"),
    )
    const otherIdx = headings.findIndex((text) =>
      text?.startsWith("Other Recurring"),
    )
    expect(streamingIdx).toBeGreaterThanOrEqual(0)
    expect(opaqueIdx).toBeGreaterThan(streamingIdx)
    expect(otherIdx).toBeGreaterThan(opaqueIdx)
  })

  it("orderedBucketKeys inserts dynamic buckets alphabetically at opaque slot", () => {
    const grouped = groupByBucket(
      [
        makeSuggestion({
          id: "paypal",
          merchant: "Hosting",
          bucket: "PAYPAL *SERVICES",
        }),
        makeSuggestion({
          id: "apple",
          merchant: "Icloud+",
          bucket: "APPLE.COM/BILL",
        }),
        makeSuggestion({
          id: "tickets",
          merchant: "Season Pass",
          bucket: "Tickets & Events",
        }),
        makeSuggestion({
          id: "streaming",
          merchant: "Spotify",
          bucket: "Streaming & Media",
        }),
      ],
      false,
    )

    expect(orderedBucketKeys(grouped)).toEqual([
      "Streaming & Media",
      "APPLE.COM/BILL",
      "PAYPAL *SERVICES",
      "Tickets & Events",
    ])
  })

  it("bucket sections render in BUCKET_ORDER and omit empty buckets", async () => {
    mockDiscoverFetch({ suggestions: MULTI_BUCKET_SUGGESTIONS })

    render(
      <TestProviders>
        <BillDiscoverPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Streaming & Media (2)" })).toBeTruthy()
    })
    expect(screen.getByRole("heading", { name: "Utilities & Telecom (1)" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Other Recurring (1)" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: /AI & Dev Tools/ })).toBeNull()
  })

  it("hide review toggle filters review status rows", async () => {
    mockDiscoverFetch({ suggestions: MULTI_BUCKET_SUGGESTIONS })

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
    mockDiscoverFetch({ suggestions: MULTI_BUCKET_SUGGESTIONS })

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
    } = mockDiscoverFetch({ suggestions: MULTI_BUCKET_SUGGESTIONS })

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

  it("shows via subtitle when cluster is set", async () => {
    mockDiscoverFetch({
      suggestions: {
        data: [
          makeSuggestion({
            id: "icloud",
            merchant: "Cloud Storage",
            bucket: "APPLE.COM/BILL",
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
          period_start: "2025-07-04",
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
      expect(screen.getAllByText("via APPLE.COM/BILL").length).toBeGreaterThan(0)
    })
  })

  it("cluster subtitle suppresses notes when both are set", async () => {
    mockDiscoverFetch({
      suggestions: {
        data: [
          makeSuggestion({
            id: "icloud",
            merchant: "Cloud Storage",
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
          period_start: "2025-07-04",
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
      expect(screen.getAllByText("via APPLE.COM/BILL").length).toBeGreaterThan(0)
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
          period_start: "2025-07-04",
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
          period_start: "2025-07-04",
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
          period_start: "2025-07-04",
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
    expect(screen.getByText("1,384 withdrawals analyzed")).toBeTruthy()
    expect(screen.getByText(/Jul 2025 – Jul \d, 2026/)).toBeTruthy()
    expect(screen.getByText("0 suggestions")).toBeTruthy()
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
})
