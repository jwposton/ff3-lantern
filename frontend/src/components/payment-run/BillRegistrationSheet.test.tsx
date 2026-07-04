import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BillRegistrationSheet } from "./BillRegistrationSheet"
import type { RegisterBillPayload } from "@/lib/paymentRunApi"

const BASE_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  defaultSection: "bills" as const,
  creditCards: [
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
      new_total: "0.00",
      interest_accrued: "0.00",
      fees: "0.00",
      last_payment_date: null,
      last_payment_amount: "0.00",
      new_transactions: [],
      planned_amount: "0.00",
      planned_amount_override: false,
      paid_at: null,
    },
  ],
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
  availableBills: [],
  loadingAvailable: false,
}

describe("BillRegistrationSheet", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("calls registerBill payload on submit", async () => {
    const onSubmit = vi.fn(async (_payload: RegisterBillPayload) => {})

    render(
      <BillRegistrationSheet {...BASE_PROPS} onSubmit={onSubmit} />,
    )

    fireEvent.change(screen.getByLabelText("Bill name"), {
      target: { value: "Electric" },
    })
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "99.00" },
    })
    fireEvent.change(screen.getByLabelText(/Rule — description contains/i), {
      target: { value: "ELECTRIC CO" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Register bill" }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "create_new",
          name: "Electric",
          amount: "99.00",
          description_contains: "ELECTRIC CO",
          worksheet_section: "bills",
          payment_rail: "bank",
          funding_bucket_key: "checking",
        }),
      )
    })
  })
})
