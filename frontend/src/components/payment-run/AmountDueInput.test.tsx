import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AmountDueInput } from "./AmountDueInput"
import type { BillRow } from "@/lib/paymentRunApi"

const RECURRING_ROW: BillRow = {
  registry_id: 1,
  row_key: "bill:1",
  row_label: "Electric",
  firefly_bill_id: "ff-1",
  amount_due: "99.00",
  amount_due_override: false,
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

const INTERMITTENT_ROW: BillRow = {
  ...RECURRING_ROW,
  registry_id: 2,
  row_key: "bill:2",
  row_label: "Car repair",
  amount_due: "0.00",
  amount_mode: "intermittent",
}

describe("AmountDueInput", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows refresh amount due for recurring bills", () => {
    render(
      <AmountDueInput row={RECURRING_ROW} isPaid={false} onCommit={async () => {}} />,
    )

    const input = screen.getByDisplayValue("99.00") as HTMLInputElement
    expect(input.value).toBe("99.00")
  })

  it("shows soft placeholder for intermittent bills with no amount due", () => {
    render(
      <AmountDueInput
        row={INTERMITTENT_ROW}
        isPaid={false}
        onCommit={async () => {}}
      />,
    )

    const input = screen.getByPlaceholderText("0.00") as HTMLInputElement
    expect(input.value).toBe("")
  })

  it("commits a typed amount due on blur", async () => {
    const onCommit = vi.fn(async () => {})

    render(
      <AmountDueInput
        row={INTERMITTENT_ROW}
        isPaid={false}
        onCommit={onCommit}
      />,
    )

    const input = screen.getByPlaceholderText("0.00")
    fireEvent.change(input, { target: { value: "425" } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("bill:2", { amount_due: "425" })
    })
  })

  it("clears a saved amount due override back to refresh default", async () => {
    const onCommit = vi.fn(async () => {})

    render(
      <AmountDueInput
        row={{
          ...RECURRING_ROW,
          amount_due: "150.00",
          amount_due_override: true,
        }}
        isPaid={false}
        onCommit={onCommit}
      />,
    )

    const input = screen.getByDisplayValue("150.00")
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("bill:1", {
        amount_due: "0.00",
        clear_amount_due_override: true,
      })
    })
  })
})
