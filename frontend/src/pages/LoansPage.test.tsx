import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { LoansPage } from "./LoansPage"
import {
  normalizeLoanAmountInput,
  normalizeLoanProfileForSave,
  saveLoanProfile,
  validateLoanProfileForSave,
  type LoanProfile,
} from "@/lib/loanApi"
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

describe("loan profile validation", () => {
  const baseProfile: LoanProfile = {
    version: 1,
    enabled: true,
    match: {
      type: "transfer",
      description_contains: "WF HOME",
      expected_amount: "2847.32",
      amount_tolerance: "0.50",
    },
    split: {
      escrow_amount: "0.00",
      components: [
        {
          role: "principal",
          type: "transfer",
          destination_account_id: "416",
          destination_account: "Mortgage",
        },
        {
          role: "interest",
          type: "transfer",
          destination_account_id: "",
          destination_account: "",
        },
        {
          role: "escrow",
          type: "transfer",
          destination_account_id: "",
          destination_account: "",
        },
      ],
    },
  }

  it("requires interest destination when enabled", () => {
    expect(validateLoanProfileForSave(baseProfile)).toBe(
      "Interest destination account is required.",
    )
  })

  it("normalizes comma-formatted amounts", () => {
    expect(normalizeLoanAmountInput("2,979.14 ")).toBe("2979.14")
    expect(normalizeLoanAmountInput("1,110.34")).toBe("1110.34")
    const profile = normalizeLoanProfileForSave(baseProfile)
    expect(profile.match.expected_amount).toBe("2847.32")
  })

  it("requires escrow destination when escrow amount is positive", () => {
    const profile: LoanProfile = {
      ...baseProfile,
      split: {
        ...baseProfile.split,
        escrow_amount: "450.00",
        components: baseProfile.split.components.map((component) =>
          component.role === "interest"
            ? {
                ...component,
                destination_account_id: "88",
                destination_account: "Mortgage Interest",
              }
            : component,
        ),
      },
    }
    expect(validateLoanProfileForSave(profile)).toBe(
      "Escrow destination account is required when escrow amount is greater than 0.",
    )
  })
})

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

  it("save profile surfaces server validation detail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (url.includes("/api/loans/42") && method === "PUT") {
        return new Response(
          JSON.stringify({ detail: "split.components: at least one interest component required" }),
          { status: 422 },
        )
      }
      return new Response("not found", { status: 404 })
    })

    await expect(
      saveLoanProfile("42", {
        version: 1,
        enabled: true,
        match: {
          description_contains: "WF HOME",
          expected_amount: "100.00",
        },
        split: {
          escrow_amount: "0.00",
          components: [
            {
              role: "principal",
              type: "transfer",
              destination_account_id: "42",
              destination_account: "Mortgage",
            },
            {
              role: "interest",
              type: "transfer",
              destination_account_id: "88",
              destination_account: "Mortgage Interest",
            },
            {
              role: "escrow",
              type: "transfer",
              destination_account_id: "",
              destination_account: "",
            },
          ],
        },
      }),
    ).rejects.toThrow("at least one interest component required")
  })

  it("save profile normalizes comma amounts in PUT body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (url.includes("/api/loans/42") && method === "PUT") {
        return new Response(JSON.stringify({ ok: true, profile: {} }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    })

    await saveLoanProfile("42", {
      version: 1,
      enabled: true,
      match: {
        description_contains: "ROCKET MORTGAGE",
        expected_amount: "2,979.14 ",
        amount_tolerance: "0",
      },
      split: {
        escrow_amount: "1,110.34",
        components: [
          {
            role: "principal",
            type: "transfer",
            destination_account_id: "42",
            destination_account: "Mortgage",
          },
          {
            role: "interest",
            type: "transfer",
            destination_account_id: "88",
            destination_account: "Mortgage Interest",
          },
          {
            role: "escrow",
            type: "transfer",
            destination_account_id: "99",
            destination_account: "Escrow",
          },
        ],
      },
    })

    const putCall = fetchSpy.mock.calls.find(
      ([url, init]) => String(url).includes("/api/loans/42") && init?.method === "PUT",
    )
    expect(putCall).toBeTruthy()
    const body = JSON.parse(String(putCall?.[1]?.body))
    expect(body.match.expected_amount).toBe("2979.14")
    expect(body.split.escrow_amount).toBe("1110.34")
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
    const interestBlock = screen.getByText("interest").closest(".space-y-3") as HTMLElement
    fireEvent.change(within(interestBlock).getAllByRole("combobox")[0], {
      target: { value: "88" },
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
