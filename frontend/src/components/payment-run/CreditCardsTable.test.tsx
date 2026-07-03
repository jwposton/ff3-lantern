import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CreditCardsTable } from "./CreditCardsTable"
import type { CreditCardRow } from "@/lib/paymentRunApi"

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
  new_total: "100.00",
  interest_accrued: "20.00",
  fees: "5.00",
  last_payment_date: null,
  last_payment_amount: "0.00",
  new_transactions: [
    {
      journal_id: "301",
      date: "2026-07-10",
      description: "Grocery Store",
      payee: "Grocery Store",
      category: "Groceries",
      budget: "Groceries",
      kind: "charge",
      amount: "75.00",
    },
    {
      journal_id: "302",
      date: "2026-07-12",
      description: "Interest",
      payee: "Interest",
      category: "Credit Card Interest",
      budget: null,
      kind: "interest",
      amount: "20.00",
    },
    {
      journal_id: "303",
      date: "2026-07-14",
      description: "Late Fee",
      payee: "Late Fee",
      category: "Late Fee(s)",
      budget: null,
      kind: "fee",
      amount: "5.00",
    },
  ],
  planned_amount: "400.00",
  planned_amount_override: false,
  paid_at: null,
}

describe("CreditCardsTable", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows expand control only when new transactions exist", () => {
    render(
      <CreditCardsTable
        rows={[
          BASE_ROW,
          {
            ...BASE_ROW,
            row_key: "cc:43",
            account_id: "43",
            name: "AmEx",
            new_transactions: [],
          },
        ]}
        buckets={[]}
        month="2026-07"
        onPlannedBlur={async () => {}}
        onPaidChange={async () => {}}
        onEditDetails={() => {}}
      />,
    )

    expect(
      screen.getByRole("button", {
        name: "Show new transactions for Chase VISA",
      }),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", {
        name: "Show new transactions for AmEx",
      }),
    ).toBeNull()
  })

  it("expands inline activity table for New transactions", () => {
    render(
      <CreditCardsTable
        rows={[BASE_ROW]}
        buckets={[]}
        month="2026-07"
        fireflyBaseUrl="https://ff.example"
        onPlannedBlur={async () => {}}
        onPaidChange={async () => {}}
        onEditDetails={() => {}}
      />,
    )

    expect(screen.queryByText("Grocery Store")).toBeNull()

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show new transactions for Chase VISA",
      }),
    )

    expect(screen.getByRole("columnheader", { name: "Payee" })).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "Budget" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Grocery Store" })).toBeTruthy()
    expect(screen.getAllByText("Groceries").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole("link", { name: "Interest" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Grocery Store" }).getAttribute("href")).toBe(
      "https://ff.example/transactions/show/301",
    )
  })
})
