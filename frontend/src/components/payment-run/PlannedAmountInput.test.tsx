import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlannedAmountInput } from "./PlannedAmountInput"
import type { BillRow, CreditCardRow } from "@/lib/paymentRunApi"

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

describe("PlannedAmountInput", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows soft placeholder instead of a hard 0.00", () => {
    render(
      <PlannedAmountInput
        row={BASE_ROW}
        isPaid={false}
        onCommit={async () => {}}
      />,
    )

    const input = screen.getByPlaceholderText("0.00") as HTMLInputElement
    expect(input.value).toBe("")
  })

  it("commits a typed planned amount on blur", async () => {
    const onCommit = vi.fn(async () => {})

    render(
      <PlannedAmountInput
        row={BASE_ROW}
        isPaid={false}
        onCommit={onCommit}
      />,
    )

    const input = screen.getByPlaceholderText("0.00")
    fireEvent.change(input, { target: { value: "425" } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("cc:42", { planned_amount: "425" })
    })
  })

  it("renders for BillRow without CreditCardRow cast", async () => {
    const billRow: BillRow = {
      registry_id: 1,
      row_key: "bill:1",
      row_label: "Electric",
      firefly_bill_id: "ff-1",
      owed: "99.00",
      planned_amount: "0.00",
      planned_amount_override: false,
      paid_at: null,
      payment_rail: "bank",
      counts_toward_cash_plan: true,
      funding_bucket_key: "checking",
      credit_card_account_id: null,
      amount_mode: "recurring",
      worksheet_section: "bills",
    }
    const onCommit = vi.fn(async () => {})

    render(
      <PlannedAmountInput row={billRow} isPaid={false} onCommit={onCommit} />,
    )

    const input = screen.getByPlaceholderText("0.00") as HTMLInputElement
    expect(input.value).toBe("")

    fireEvent.change(input, { target: { value: "125.50" } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("bill:1", {
        planned_amount: "125.50",
      })
    })
  })

  it("clears a saved planned amount back to soft zero", async () => {
    const onCommit = vi.fn(async () => {})

    render(
      <PlannedAmountInput
        row={{
          ...BASE_ROW,
          planned_amount: "425.00",
          planned_amount_override: true,
        }}
        isPaid={false}
        onCommit={onCommit}
      />,
    )

    const input = screen.getByDisplayValue("425.00")
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("cc:42", {
        planned_amount: "0.00",
        clear_planned_override: true,
      })
    })
  })
})
