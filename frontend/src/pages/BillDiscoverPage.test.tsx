import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { BillDiscoverPage } from "./BillDiscoverPage"
import type { BillSuggestionsEnvelope } from "@/lib/paymentRunApi"

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
}) {
  const paymentEnabled = options.paymentEnabled ?? true
  const suggestions = options.suggestions ?? SUGGESTIONS_FIXTURE
  let suggestionsCalls = 0
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

    return new Response("not found", { status: 404 })
  })

  return {
    fetchSpy,
    getSuggestionsCalls: () => suggestionsCalls,
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
    expect(screen.getByText(/Jul 2025 – Jul \d, 2026/)).toBeTruthy()
    expect(screen.getByText("49 suggestions")).toBeTruthy()
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
})
