import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CreditCardSheet } from "./CreditCardSheet"
import type { CreditCardRow } from "@/lib/paymentRunApi"

vi.mock("@/lib/paymentRunApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paymentRunApi")>()
  return {
    ...actual,
    fetchExternalLinks: vi.fn(),
  }
})

import { fetchExternalLinks } from "@/lib/paymentRunApi"

function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const BASE_ROW: CreditCardRow = {
  account_id: "42",
  row_key: "cc:42",
  name: "Chase VISA",
  credit_limit: "10000.00",
  funding_bucket_key: "checking",
  default_planned_payment: "200.00",
  payment_due_day: "15",
  apr_percent: "24.99",
  owed: "1200.00",
  new_total: "0.00",
  interest_accrued: "0.00",
  fees: "0.00",
  last_payment_date: null,
  last_payment_amount: "0.00",
  new_transactions: [],
  planned_amount: "0.00",
  planned_amount_override: false,
  paid_at: null,
}

const BASE_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  row: BASE_ROW,
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
  onSave: vi.fn().mockResolvedValue(undefined),
  onExclude: vi.fn().mockResolvedValue(undefined),
}

describe("CreditCardSheet", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.mocked(fetchExternalLinks).mockResolvedValue({
      data: [
        {
          id: "chase-login",
          label: "Chase",
          url: "https://chase.com",
          dependents: { total: 0 },
        },
      ],
    })
  })

  it("expands Special rate section when promo data exists on open", () => {
    render(
      <TestProviders>
        <CreditCardSheet
          {...BASE_PROPS}
          row={{
            ...BASE_ROW,
            special_apr_percent: "0",
            special_apr_start: "2026-07-01",
            special_apr_end: "2026-09-30",
          }}
        />
      </TestProviders>,
    )

    expect(screen.getByLabelText("Promo APR %")).toBeTruthy()
    expect(screen.getByDisplayValue("0")).toBeTruthy()
    expect(screen.getByDisplayValue("2026-07-01")).toBeTruthy()
    expect(screen.getByDisplayValue("2026-09-30")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Clear special rate" })).toBeTruthy()
  })

  it("blocks save when only promo percent is filled", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <TestProviders>
        <CreditCardSheet
          {...BASE_PROPS}
          onSave={onSave}
        />
      </TestProviders>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Special rate" }))
    fireEvent.change(screen.getByLabelText("Promo APR %"), {
      target: { value: "0" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(
        screen.getByText(
          "Special rate requires promo APR, start date, and end date together.",
        ),
      ).toBeTruthy()
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it("clear special rate saves all three promo fields as null", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <TestProviders>
        <CreditCardSheet
          {...BASE_PROPS}
          onSave={onSave}
          row={{
            ...BASE_ROW,
            special_apr_percent: "0",
            special_apr_start: "2026-07-01",
            special_apr_end: "2026-09-30",
          }}
        />
      </TestProviders>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Clear special rate" }))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("42", expect.objectContaining({
        special_apr_percent: null,
        special_apr_start: null,
        special_apr_end: null,
      }))
    })
  })

  it("renders external link select when catalog has links", async () => {
    render(
      <TestProviders>
        <CreditCardSheet {...BASE_PROPS} />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("external-link-select")).toBeTruthy()
    })
  })

  it("includes external_link_id in onSave when link attached", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <TestProviders>
        <CreditCardSheet {...BASE_PROPS} onSave={onSave} />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("external-link-select")).toBeTruthy()
    })

    fireEvent.change(screen.getByTestId("external-link-select"), {
      target: { value: "chase-login" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        "42",
        expect.objectContaining({
          external_link_id: "chase-login",
        }),
      )
    })
  })
})
