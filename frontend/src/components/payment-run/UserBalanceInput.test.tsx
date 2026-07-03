import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UserBalanceInput } from "./UserBalanceInput"
import type { FundingBucketRollup } from "@/lib/paymentRunApi"

const BASE_BUCKET: FundingBucketRollup = {
  id: "checking",
  label: "Checking",
  sort_order: 0,
  reported_balance: "5000.00",
  user_balance: "5000.00",
  user_balance_override: false,
  planned_outflows: "0.00",
  remaining: "5000.00",
}

describe("UserBalanceInput", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows reported balance as a soft placeholder", () => {
    render(
      <UserBalanceInput bucket={BASE_BUCKET} onCommit={async () => {}} />,
    )

    const input = screen.getByPlaceholderText("5000.00") as HTMLInputElement
    expect(input.value).toBe("")
  })

  it("commits an override on blur", async () => {
    const onCommit = vi.fn(async () => {})

    render(<UserBalanceInput bucket={BASE_BUCKET} onCommit={onCommit} />)

    const input = screen.getByPlaceholderText("5000.00")
    fireEvent.change(input, { target: { value: "4800" } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("checking", { user_balance: "4800" })
    })
  })

  it("resets to reported when a saved override is cleared", async () => {
    const onCommit = vi.fn(async () => {})

    render(
      <UserBalanceInput
        bucket={{
          ...BASE_BUCKET,
          user_balance: "4800.00",
          user_balance_override: true,
          remaining: "4800.00",
        }}
        onCommit={onCommit}
      />,
    )

    const input = screen.getByDisplayValue("4800.00")
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("checking", {
        user_balance: "0.00",
        reset_to_reported: true,
      })
    })
  })
})
