import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { LoanSplitsQueuePage } from "./LoanSplitsQueuePage"

const RANGE = { start: "2026-07-01", end: "2026-07-31" }

const PENDING_ROW = {
  journal_id: "100",
  transaction_journal_id: "1001",
  description: "Loan Provider July",
  amount: "427.18",
  date: "2026-07-10",
  profile_account_id: "42",
  preview: { principal: "156.35", interest: "270.83", escrow: "0.00" },
  warning: false,
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
    if (url.includes("/api/loan-splits/pending") && method === "GET") {
      return new Response(JSON.stringify(handlers.pending?.()), { status: 200 })
    }
    if (url.includes("/apply") && method === "POST") {
      return new Response(JSON.stringify(handlers.apply?.() ?? { ok: true }), {
        status: 200,
      })
    }
    return new Response("not found", { status: 404 })
  })
}

describe("LoanSplitsQueuePage", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders pending card", async () => {
    mockFetch({
      pending: () => ({
        data: [PENDING_ROW],
        meta: { count: 1, ...RANGE, forward_only_since: "2026-07-01" },
      }),
    })

    render(
      <TestProviders>
        <LoanSplitsQueuePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Loan Provider July")).toBeTruthy()
    })
  })

  it("apply calls mock fetch with overridden principal", async () => {
    const fetchSpy = mockFetch({
      pending: () => ({
        data: [PENDING_ROW],
        meta: { count: 1, ...RANGE, forward_only_since: "2026-07-01" },
      }),
      apply: () => ({ ok: true, journal_id: "100" }),
    })

    render(
      <TestProviders>
        <LoanSplitsQueuePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Loan Provider July")).toBeTruthy()
    })

    const principalInput = screen.getByLabelText(/principal/i)
    fireEvent.change(principalInput, { target: { value: "160.00" } })
    fireEvent.click(screen.getByRole("button", { name: /Apply split/i }))

    await waitFor(() => {
      const applyCall = fetchSpy.mock.calls.find(
        ([url]) => String(url).includes("/api/loan-splits/100/apply"),
      )
      expect(applyCall).toBeTruthy()
      const body = JSON.parse(String(applyCall?.[1]?.body))
      expect(body.principal).toBe("160.00")
    })
  })

  it("skip removes card without apply POST", async () => {
    const fetchSpy = mockFetch({
      pending: () => ({
        data: [PENDING_ROW],
        meta: { count: 1, ...RANGE, forward_only_since: "2026-07-01" },
      }),
    })

    render(
      <TestProviders>
        <LoanSplitsQueuePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Loan Provider July")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Skip" }))

    await waitFor(() => {
      expect(screen.queryByText("Loan Provider July")).toBeNull()
    })

    const applyCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/apply"),
    )
    expect(applyCalls).toHaveLength(0)
  })

  it("apply success invalidates normalizedTransactions cache", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

    mockFetch({
      pending: () => ({
        data: [PENDING_ROW],
        meta: { count: 1, ...RANGE, forward_only_since: "2026-07-01" },
      }),
      apply: () => ({ ok: true, journal_id: "100" }),
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/?start=${RANGE.start}&end=${RANGE.end}`]}>
          <DateRangeProvider>
            <LoanSplitsQueuePage />
          </DateRangeProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Loan Provider July")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Apply split/i }))

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

  it("renders Open in Firefly link when firefly_base_url configured", async () => {
    mockFetch({
      pending: () => ({
        data: [PENDING_ROW],
        meta: { count: 1, ...RANGE, forward_only_since: "2026-07-01" },
      }),
      normalized: () => ({
        data: [],
        firefly_base_url: "https://ff.example",
      }),
    })

    render(
      <TestProviders>
        <LoanSplitsQueuePage />
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
      pending: () => ({
        data: [PENDING_ROW],
        meta: { count: 1, ...RANGE, forward_only_since: "2026-07-01" },
      }),
      normalized: () => ({ data: [] }),
    })

    render(
      <TestProviders>
        <LoanSplitsQueuePage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Loan Provider July")).toBeTruthy()
    })
    expect(screen.queryByRole("link", { name: /Open in Firefly/i })).toBeNull()
  })
})
