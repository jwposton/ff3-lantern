import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CreditCardSheet } from "./CreditCardSheet"
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

  it("expands Special rate section when promo data exists on open", () => {
    render(
      <CreditCardSheet
        {...BASE_PROPS}
        row={{
          ...BASE_ROW,
          special_apr_percent: "0",
          special_apr_start: "2026-07-01",
          special_apr_end: "2026-09-30",
        }}
      />,
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
      <CreditCardSheet
        {...BASE_PROPS}
        onSave={onSave}
      />,
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
      <CreditCardSheet
        {...BASE_PROPS}
        onSave={onSave}
        row={{
          ...BASE_ROW,
          special_apr_percent: "0",
          special_apr_start: "2026-07-01",
          special_apr_end: "2026-09-30",
        }}
      />,
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
})
