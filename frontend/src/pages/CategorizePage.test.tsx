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

type PendingListPayload = { data?: unknown[]; meta?: Record<string, unknown> }

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
      const grouped = url.includes("group_by_fingerprint=true")
      const flat = (handlers.pending?.() ?? { data: [], meta: {} }) as PendingListPayload
      if (grouped && handlers.groupedPending) {
        return new Response(JSON.stringify(handlers.groupedPending()), { status: 200 })
      }
      if (grouped && flat.data?.length) {
        const rows = flat.data as typeof PENDING_ROW[]
        return new Response(
          JSON.stringify({
            data: rows.map((row) => ({
              fingerprint: row.description.toLowerCase(),
              count: 1,
              sample_description: row.description,
              journal_ids: [row.journal_id],
              rows: [row],
            })),
            meta: {
              count: rows.length,
              group_count: rows.length,
              grouped: true,
              ...RANGE,
              limit: 50,
            },
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify(flat), { status: 200 })
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
    if (url.includes("/api/categorize/rules/preview") && method === "POST") {
      return new Response(JSON.stringify(handlers.rulePreview?.() ?? { data: {} }), {
        status: 200,
      })
    }
    if (url.includes("/api/categorize/rules") && method === "POST" && !url.includes("/trigger")) {
      return new Response(JSON.stringify(handlers.ruleCreate?.() ?? { data: { rule_id: "99" } }), {
        status: 200,
      })
    }
    if (url.includes("/api/categorize/rules/") && url.includes("/trigger") && method === "POST") {
      return new Response(JSON.stringify(handlers.ruleTrigger?.() ?? { ok: true }), {
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

  it("rule mode renders without prior suggest", async () => {
    mockFetch({
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
      normalized: () => ({ data: [], firefly_base_url: "https://firefly.example" }),
    })

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("AMZN MKTP")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Rule mode" }))

    expect(screen.getByRole("button", { name: "Preview matches" })).toBeTruthy()
    expect(screen.getByDisplayValue("Amazon")).toBeTruthy()
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
      expect(screen.getByText("Nothing to categorize")).toBeTruthy()
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

    const suggestCalls = fetchSpy.mock.calls.filter(([url]) =>
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
            args != null &&
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
      "https://ff.example/transactions/show/100",
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

describe("CategorizePage grouped queue", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  const ROW_B = {
    ...PENDING_ROW,
    journal_id: "101",
    transaction_journal_id: "1002",
    description: "amzn mktp",
  }

  it("shows similar count for multi-member group", async () => {
    mockFetch({
      groupedPending: () => ({
        data: [
          {
            fingerprint: "amzn mktp",
            count: 2,
            sample_description: "AMZN MKTP",
            journal_ids: ["100", "101"],
            rows: [PENDING_ROW, ROW_B],
          },
        ],
        meta: {
          count: 2,
          group_count: 1,
          grouped: true,
          ...RANGE,
          limit: 50,
        },
      }),
      meta: () => ({
        openrouter_configured: true,
        categories: [{ id: "1", name: "Shopping" }],
        budgets: [],
        default_model: "openai/gpt-4o-mini",
      }),
      suggest: () => ({
        data: [
          {
            journal_id: "100",
            cached: false,
            suggestion: {
              category: "Shopping",
              budget: null,
              confidence: 0.9,
              recommendation: "direct",
              rationale: "A",
            },
          },
          {
            journal_id: "101",
            cached: false,
            suggestion: {
              category: "Shopping",
              budget: null,
              confidence: 0.9,
              recommendation: "direct",
              rationale: "B",
            },
          },
        ],
      }),
    })

    render(
      <TestProviders>
        <CategorizePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText(/2 similar transactions/i)).toBeTruthy()
    })

    fireEvent.click(screen.getByText(/2 similar transactions/i))
    fireEvent.click(screen.getByRole("button", { name: /Suggest categories/i }))

    await waitFor(() => {
      expect(screen.getByText("A")).toBeTruthy()
      expect(screen.getByText("B")).toBeTruthy()
    })
  })
})

describe("CategorizePage rule graduation", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("backfill checkbox unchecked by default", async () => {
    mockFetch({
      pending: () => ({ data: [PENDING_ROW], meta: { count: 1, ...RANGE, limit: 50 } }),
      meta: () => ({
        openrouter_configured: true,
        categories: [{ id: "1", name: "Shopping" }],
        budgets: [],
        default_model: "openai/gpt-4o-mini",
      }),
      suggest: () => ({
        data: [
          {
            journal_id: "100",
            cached: false,
            suggestion: {
              category: "Shopping",
              budget: null,
              confidence: 0.9,
              recommendation: "rule",
              rationale: "Recurring",
              rule: {
                title: "Amazon",
                description_contains: "AMZN",
                transaction_type: "withdrawal",
              },
            },
          },
        ],
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
    fireEvent.click(screen.getByRole("button", { name: /Suggest categories/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/Apply rule to existing/i)).toBeTruthy()
    })
    const checkbox = screen.getByLabelText(
      /Apply rule to existing/i,
    ) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
  })

  it("create without backfill does not call trigger", async () => {
    const fetchSpy = mockFetch({
      pending: () => ({ data: [PENDING_ROW], meta: { count: 1, ...RANGE, limit: 50 } }),
      meta: () => ({
        openrouter_configured: true,
        categories: [{ id: "1", name: "Shopping" }],
        budgets: [],
        default_model: "openai/gpt-4o-mini",
      }),
      suggest: () => ({
        data: [
          {
            journal_id: "100",
            cached: false,
            suggestion: {
              category: "Shopping",
              budget: null,
              confidence: 0.9,
              recommendation: "rule",
              rationale: "Recurring",
              rule: {
                title: "Amazon",
                description_contains: "AMZN",
                transaction_type: "withdrawal",
              },
            },
          },
        ],
      }),
      rulePreview: () => ({
        data: { total: 3, uncategorized_count: 1, categorized_count: 2 },
      }),
      ruleCreate: () => ({ data: { rule_id: "55" } }),
    })

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
      expect(screen.getByRole("button", { name: /Preview matches/i })).toBeTruthy()
    })

    const categorySelect = screen.getByLabelText("Category") as HTMLSelectElement
    fireEvent.change(categorySelect, { target: { value: "1" } })
    fireEvent.click(screen.getByRole("button", { name: /Preview matches/i }))

    await waitFor(() => {
      expect(screen.getByText(/1 uncategorized/i)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /^Create rule$/i }))

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/api/categorize/rules") &&
            !String(url).includes("/trigger") &&
            init?.method === "POST",
        ),
      ).toBe(true)
    })

    const triggerCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/trigger"),
    )
    expect(triggerCalls).toHaveLength(0)
  })

  it("create with backfill calls trigger after create", async () => {
    const fetchSpy = mockFetch({
      pending: () => ({ data: [PENDING_ROW], meta: { count: 1, ...RANGE, limit: 50 } }),
      meta: () => ({
        openrouter_configured: true,
        categories: [{ id: "1", name: "Shopping" }],
        budgets: [],
        default_model: "openai/gpt-4o-mini",
      }),
      suggest: () => ({
        data: [
          {
            journal_id: "100",
            cached: false,
            suggestion: {
              category: "Shopping",
              budget: null,
              confidence: 0.9,
              recommendation: "rule",
              rationale: "Recurring",
              rule: {
                title: "Amazon",
                description_contains: "AMZN",
                transaction_type: "withdrawal",
              },
            },
          },
        ],
      }),
      rulePreview: () => ({
        data: { total: 3, uncategorized_count: 1, categorized_count: 2 },
      }),
      ruleCreate: () => ({ data: { rule_id: "55" } }),
      ruleTrigger: () => ({ ok: true, rule_id: "55" }),
    })

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
      expect(screen.getByRole("button", { name: /Preview matches/i })).toBeTruthy()
    })

    const categorySelect = screen.getByLabelText("Category") as HTMLSelectElement
    fireEvent.change(categorySelect, { target: { value: "1" } })
    fireEvent.click(screen.getByRole("button", { name: /Preview matches/i }))

    await waitFor(() => {
      expect(screen.getByText(/1 uncategorized/i)).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText(/Apply rule to existing/i))
    fireEvent.click(screen.getByRole("button", { name: /^Create rule$/i }))

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(([url]) => String(url).includes("/rules/55/trigger")),
      ).toBe(true)
    })
  })
})
