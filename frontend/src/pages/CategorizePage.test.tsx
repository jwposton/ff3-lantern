import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { CategorizePage } from "./CategorizePage"

const RANGE = { start: "2024-06-01", end: "2024-06-30" }

const PENDING_ROW = {
  journal_id: "100",
  transaction_journal_id: "1001",
  date: "2024-06-15",
  amount: "-42.00",
  description: "AMZN MKTP",
  type: "withdrawal",
  source_name: "Checking",
  destination_name: "Amazon",
  budget_name: null,
}

function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/?start=${RANGE.start}&end=${RANGE.end}`]}>
        <DateRangeProvider>{children}</DateRangeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockFetch(handlers: Record<string, () => unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url.includes("/api/normalized_transactions") && method === "GET") {
      return new Response(
        JSON.stringify(
          handlers.normalized?.() ?? { data: [], firefly_base_url: undefined },
        ),
        { status: 200 },
      )
    }
    if (url.includes("/api/categorize/pending") && method === "GET") {
      return new Response(JSON.stringify(handlers.pending?.() ?? { data: [], meta: {} }), {
        status: 200,
      })
    }
    if (url.includes("/api/categorize/meta") && method === "GET") {
      return new Response(JSON.stringify(handlers.meta?.()), { status: 200 })
    }
    if (url.includes("/api/categorize/suggest") && method === "POST") {
      return new Response(JSON.stringify(handlers.suggest?.()), { status: 200 })
    }
    if (url.includes("/apply") && method === "POST") {
      return new Response(JSON.stringify(handlers.apply?.() ?? { ok: true }), {
        status: 200,
      })
    }
    return new Response("not found", { status: 404 })
  })
}

describe("categorize api hooks", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("fetches pending and meta endpoints", async () => {
    const fetchSpy = mockFetch({
      pending: () => ({
        data: [PENDING_ROW],
        meta: { count: 1, ...RANGE, limit: 50 },
      }),
      meta: () => ({
        openrouter_configured: true,
        categories: [{ id: "1", name: "Shopping" }],
        budgets: [],
        default_model: "openai/gpt-4o-mini",
      }),
    })

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("AMZN MKTP")).toBeTruthy()
    })

    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("/api/categorize/pending"),
      ),
    ).toBe(true)
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("/api/categorize/meta"),
      ),
    ).toBe(true)
  })
})

describe("CategorizePage degraded or empty", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows degraded banner and hides Suggest when openrouter not configured", async () => {
    mockFetch({
      pending: () => ({ data: [PENDING_ROW], meta: { count: 1, ...RANGE, limit: 50 } }),
      meta: () => ({
        openrouter_configured: false,
        categories: [],
        budgets: [],
        default_model: "openai/gpt-4o-mini",
      }),
    })

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText(/AI suggestions unavailable/i)).toBeTruthy()
    })
    expect(screen.queryByRole("button", { name: /Suggest categories/i })).toBeNull()
  })

  it("shows empty state when no pending rows", async () => {
    mockFetch({
      pending: () => ({ data: [], meta: { count: 0, ...RANGE, limit: 50 } }),
      meta: () => ({
        openrouter_configured: true,
        categories: [],
        budgets: [],
        default_model: "openai/gpt-4o-mini",
      }),
    })

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("No uncategorized transactions")).toBeTruthy()
    })
  })

  it("shows Suggest button when openrouter configured", async () => {
    mockFetch({
      pending: () => ({ data: [PENDING_ROW], meta: { count: 1, ...RANGE, limit: 50 } }),
      meta: () => ({
        openrouter_configured: true,
        categories: [{ id: "1", name: "Shopping" }],
        budgets: [],
        default_model: "openai/gpt-4o-mini",
      }),
    })

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Suggest categories/i })).toBeTruthy()
    })
  })
})

describe("CategorizePage interactions", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    mockFetch({
      pending: () => ({ data: [PENDING_ROW], meta: { count: 1, ...RANGE, limit: 50 } }),
      meta: () => ({
        openrouter_configured: true,
        categories: [{ id: "1", name: "Shopping" }],
        budgets: [{ id: "2", name: "Household" }],
        default_model: "openai/gpt-4o-mini",
      }),
      suggest: () => ({
        data: [
          {
            journal_id: "100",
            cached: false,
            suggestion: {
              category: "Shopping",
              budget: "Household",
              confidence: 0.92,
              recommendation: "direct",
              rationale: "Amazon purchase",
            },
          },
        ],
      }),
      apply: () => ({ ok: true, journal_id: "100" }),
    })
  })

  it("does not call suggest on render", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("AMZN MKTP")).toBeTruthy()
    })

    const suggestCalls = fetchSpy.mock.calls.filter(([url, init]) =>
      String(url).includes("/suggest"),
    )
    expect(suggestCalls).toHaveLength(0)
  })

  it("calls suggest once when button clicked", async () => {
    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Suggest categories/i })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Suggest categories/i }))

    await waitFor(() => {
      expect(screen.getByText("Amazon purchase")).toBeTruthy()
    })
  })

  it("skip removes card without apply call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("AMZN MKTP")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Skip" }))

    await waitFor(() => {
      expect(screen.queryByText("AMZN MKTP")).toBeNull()
    })

    const applyCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/apply"),
    )
    expect(applyCalls).toHaveLength(0)
  })

  it("approve sends selected category_id to apply endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Suggest categories/i })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Suggest categories/i }))

    await waitFor(() => {
      expect(screen.getByText("Amazon purchase")).toBeTruthy()
    })

    const categorySelect = screen.getByLabelText("Category") as HTMLSelectElement
    fireEvent.change(categorySelect, { target: { value: "1" } })

    fireEvent.click(screen.getByRole("button", { name: "Approve" }))

    await waitFor(() => {
      const applyCall = fetchSpy.mock.calls.find(([url]) =>
        String(url).includes("/api/categorize/100/apply"),
      )
      expect(applyCall).toBeTruthy()
      const body = JSON.parse(String(applyCall?.[1]?.body))
      expect(body.category_id).toBe("1")
      expect(body.transaction_journal_id).toBe("1001")
    })
  })

  it("approve success invalidates normalizedTransactions cache", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/?start=${RANGE.start}&end=${RANGE.end}`]}>
          <DateRangeProvider>
            <CategorizePage />
          </DateRangeProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Suggest categories/i })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Suggest categories/i }))

    await waitFor(() => {
      expect(screen.getByText("Amazon purchase")).toBeTruthy()
    })

    const categorySelect = screen.getByLabelText("Category") as HTMLSelectElement
    fireEvent.change(categorySelect, { target: { value: "1" } })
    fireEvent.click(screen.getByRole("button", { name: "Approve" }))

    await waitFor(() => {
      expect(
        invalidateSpy.mock.calls.some(
          ([args]) =>
            Array.isArray(args.queryKey) &&
            args.queryKey[0] === "normalizedTransactions",
        ),
      ).toBe(true)
    })
  })
})

describe("CategorizePage Firefly links", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders Open in Firefly link when firefly_base_url is configured", async () => {
    mockFetch({
      pending: () => ({ data: [PENDING_ROW], meta: { count: 1, ...RANGE, limit: 50 } }),
      meta: () => ({
        openrouter_configured: false,
        categories: [],
        budgets: [],
        default_model: "openai/gpt-4o-mini",
      }),
      normalized: () => ({
        data: [],
        firefly_base_url: "https://ff.example",
      }),
    })

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Open in Firefly/i })).toBeTruthy()
    })
    expect(screen.getByRole("link", { name: /Open in Firefly/i }).getAttribute("href")).toBe(
      "https://ff.example/transactions/show/1001",
    )
  })

  it("hides link when firefly_base_url absent", async () => {
    mockFetch({
      pending: () => ({ data: [PENDING_ROW], meta: { count: 1, ...RANGE, limit: 50 } }),
      meta: () => ({
        openrouter_configured: false,
        categories: [],
        budgets: [],
        default_model: "openai/gpt-4o-mini",
      }),
      normalized: () => ({ data: [] }),
    })

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("AMZN MKTP")).toBeTruthy()
    })
    expect(screen.queryByRole("link", { name: /Open in Firefly/i })).toBeNull()
  })
})
