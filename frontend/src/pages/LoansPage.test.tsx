import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { LoansPage } from "./LoansPage"
import { LoanProfilePage } from "./LoanProfilePage"

const LOAN_ROW = {
  account_id: "42",
  name: "Mortgage Liability",
  profile: null,
  enabled: false,
  configured: false,
}

function TestProviders({
  children,
  initialEntry = "/",
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
        <DateRangeProvider>{children}</DateRangeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockFetch(handlers: Record<string, () => unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url.includes("/api/loans/meta") && method === "GET") {
      return new Response(
        JSON.stringify(
          handlers.meta?.() ?? {
            liability_accounts: [],
            expense_accounts: [],
            asset_accounts: [],
            categories: [],
            budgets: [],
          },
        ),
        { status: 200 },
      )
    }
    if (
      url.includes("/api/loans") &&
      method === "GET" &&
      !url.match(/\/api\/loans\/[^/]+$/)
    ) {
      return new Response(JSON.stringify(handlers.loans?.() ?? { data: [] }), {
        status: 200,
      })
    }
    if (url.match(/\/api\/loans\/[^/]+$/) && method === "GET") {
      return new Response(JSON.stringify(handlers.loan?.()), { status: 200 })
    }
    if (url.includes("/api/loans/") && method === "PUT") {
      return new Response(JSON.stringify(handlers.put?.() ?? { ok: true }), {
        status: 200,
      })
    }
    return new Response("not found", { status: 404 })
  })
}

describe("loan api or hook", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("fetches loans list", async () => {
    const fetchSpy = mockFetch({
      loans: () => ({ data: [LOAN_ROW] }),
    })

    render(
      <TestProviders>
        <LoansPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Mortgage Liability")).toBeTruthy()
    })

    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes("/api/loans")),
    ).toBe(true)
  })
})

describe("LoansPage", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders account name from mock", async () => {
    mockFetch({ loans: () => ({ data: [LOAN_ROW] }) })
    render(
      <TestProviders>
        <LoansPage />
      </TestProviders>,
    )
    await waitFor(() => {
      expect(screen.getByText("Mortgage Liability")).toBeTruthy()
    })
  })

  it("save profile test asserts fetch PUT called", async () => {
    const fetchSpy = mockFetch({
      meta: () => ({
        liability_accounts: [{ id: "42", name: "Mortgage Liability" }],
        expense_accounts: [{ id: "88", name: "Mortgage Interest" }],
        asset_accounts: [],
        categories: [{ id: "1", name: "Loan Interest" }],
        budgets: [{ id: "2", name: "Debt" }],
      }),
      loan: () => ({
        account_id: "42",
        name: "Mortgage Liability",
        interest: "6.5",
        profile: null,
        enabled: false,
      }),
      put: () => ({ ok: true, profile: {} }),
    })

    render(
      <TestProviders initialEntry="/manage/loans/42">
        <Routes>
          <Route path="/manage/loans/:accountId" element={<LoanProfilePage />} />
        </Routes>
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Mortgage Liability" })).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText(/Description contains/i), {
      target: { value: "Loan Provider" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Save profile/i }))

    await waitFor(() => {
      const putCall = fetchSpy.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/loans/42") && init?.method === "PUT",
      )
      expect(putCall).toBeTruthy()
    })
  })
})
