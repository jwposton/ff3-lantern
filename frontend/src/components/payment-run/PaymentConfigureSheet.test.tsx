import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { PaymentConfigureSheet } from "./PaymentConfigureSheet"
import type {
  BillRow,
  CreditCardRow,
  LiabilityRow,
} from "@/lib/paymentRunApi"

const BILLS: BillRow[] = [
  {
    registry_id: 1,
    row_key: "bill:1",
    row_label: "Electric",
    firefly_bill_id: "ff-1",
    owed: "50.00",
    planned_amount: "50.00",
    planned_amount_override: false,
    paid_at: null,
    payment_rail: "bank",
    counts_toward_cash_plan: true,
    funding_bucket_key: "checking",
    credit_card_account_id: null,
    amount_mode: "recurring",
    worksheet_section: "bills",
  },
]

const CREDIT_CARDS: CreditCardRow[] = [
  {
    account_id: "42",
    row_key: "cc:42",
    name: "Chase VISA",
    credit_limit: "10000.00",
    funding_bucket_key: "checking",
    default_planned_payment: "200.00",
    payment_due_day: "15",
    apr_percent: "24.99",
    owed: "1200.00",
    new_total: "100.00",
    interest_accrued: "20.00",
    fees: "5.00",
    last_payment_date: null,
    last_payment_amount: "0.00",
    new_transactions: [],
    planned_amount: "400.00",
    planned_amount_override: false,
    paid_at: null,
  },
]

const LIABILITIES: LiabilityRow[] = [
  {
    account_id: "loan-1",
    row_key: "liability:loan-1",
    name: "Mortgage",
    owed: "250000.00",
    est_interest: "800.00",
    remaining_payments: 142,
    planned_amount: "1800.00",
    planned_amount_override: false,
    paid_at: null,
    funding_bucket_key: "checking",
    default_planned_payment: "1800.00",
  },
]

function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

function mockConfigureFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)

    if (url.includes("/api/payment-run/available")) {
      return new Response(
        JSON.stringify({ data: [{ id: "ff-99", name: "Spotify" }] }),
        { status: 200 },
      )
    }

    if (url.includes("/api/loans") && !url.includes("/meta")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              account_id: "loan-1",
              name: "Mortgage",
              profile: {
                version: 1,
                enabled: true,
                match: { description_contains: "MORTGAGE", expected_amount: "1800.00" },
                split: { escrow_amount: "0", components: [] },
              },
              enabled: true,
              configured: true,
            },
          ],
        }),
        { status: 200 },
      )
    }

    return new Response("not found", { status: 404 })
  })
}

describe("PaymentConfigureSheet", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders configure sections and registered bill data", async () => {
    mockConfigureFetch()

    render(
      <TestProviders>
        <PaymentConfigureSheet
          open
          onOpenChange={() => {}}
          buckets={[
            {
              id: "checking",
              label: "Checking",
              sort_order: 0,
              firefly_account_ids: ["1"],
              reported_balance: "5000.00",
              user_balance: "5000.00",
              user_balance_override: false,
              planned_outflows: "200.00",
              remaining: "4800.00",
            },
          ]}
          creditCards={CREDIT_CARDS}
          bills={BILLS}
          liabilities={LIABILITIES}
          excludedCreditCards={[]}
          excludedLiabilities={[]}
          accountNameById={new Map([["1", "Main Checking"]])}
          onRegisterBill={() => {}}
          onEditBill={() => {}}
          onRemoveBill={() => {}}
          onLinkBill={() => {}}
          onEditCard={() => {}}
          onEditLiabilityAccount={() => {}}
          onManageExcludedCards={() => {}}
          onManageExcludedLiabilities={() => {}}
        />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Configure worksheet" }),
      ).toBeTruthy()
      expect(screen.getByText("Electric")).toBeTruthy()
      expect(screen.getByText("Spotify")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Credit cards" }))
    expect(screen.getByText("Chase VISA")).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", { name: "Loans & liabilities" }),
    )
    await waitFor(() => {
      expect(screen.getByText("Mortgage")).toBeTruthy()
      expect(screen.getByText("Loan configured")).toBeTruthy()
    })
  })
})
