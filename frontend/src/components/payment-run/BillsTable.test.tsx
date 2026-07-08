import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { BillsTable } from "./BillsTable"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { BillForecast, BillRow, WorksheetBillGroupSummary } from "@/lib/paymentRunApi"
import { STORAGE_KEY } from "@/lib/worksheetBillGroupExpand"

function makeBill(
  overrides: Partial<BillRow> & Pick<BillRow, "registry_id" | "row_key">,
): BillRow {
  return {
    row_label: `Bill ${overrides.registry_id}`,
    firefly_bill_id: null,
    paid_at: null,
    payment_rail: "bank",
    counts_toward_cash_plan: true,
    funding_bucket_key: "checking",
    credit_card_account_id: null,
    amount_mode: "recurring",
    worksheet_section: "bills",
    amount_due: "100.00",
    amount_due_override: false,
    planned_amount: "100.00",
    planned_amount_override: false,
    show_in_group: true,
    bill_group_id: null,
    ...overrides,
  }
}

function makeGroup(
  overrides: Partial<WorksheetBillGroupSummary> & Pick<WorksheetBillGroupSummary, "id">,
): WorksheetBillGroupSummary {
  return {
    label: overrides.id,
    sort_order: 0,
    member_count: 0,
    visible_count: 0,
    ...overrides,
  }
}

const utilitiesGroup = makeGroup({
  id: "utilities",
  label: "Utilities",
  sort_order: 1,
  member_count: 3,
  visible_count: 2,
})

const groupedFixtureRows = [
  makeBill({
    registry_id: 1,
    row_key: "bills:1",
    row_label: "Electric",
    bill_group_id: "utilities",
    show_in_group: true,
    amount_due: "50.00",
    planned_amount: "50.00",
  }),
  makeBill({
    registry_id: 2,
    row_key: "bills:2",
    row_label: "Water",
    bill_group_id: "utilities",
    show_in_group: true,
    amount_due: "75.25",
    planned_amount: "75.25",
    paid_at: "2026-07-01T00:00:00Z",
  }),
  makeBill({
    registry_id: 3,
    row_key: "bills:3",
    row_label: "Gas",
    bill_group_id: "utilities",
    show_in_group: false,
    amount_due: "30.00",
    planned_amount: "30.00",
  }),
  makeBill({
    registry_id: 10,
    row_key: "bills:10",
    row_label: "AAA Ungrouped",
    bill_group_id: null,
    amount_due: "20.00",
    planned_amount: "20.00",
  }),
]

const subtotals = { owed: "0.00", due: "175.25", planned_cash: "175.25" }

function renderBillsTable(
  overrides: Partial<ComponentProps<typeof BillsTable>> = {},
) {
  const onPlannedBlur = vi.fn(async () => {})
  const onAmountDueBlur = vi.fn(async () => {})
  const onPaidChange = vi.fn(async () => {})

  render(
    <MemoryRouter>
      <BillsTable
        rows={groupedFixtureRows}
        billGroups={[utilitiesGroup]}
        buckets={[
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
        ]}
        creditCards={[]}
        subtotals={subtotals}
        onPlannedBlur={onPlannedBlur}
        onAmountDueBlur={onAmountDueBlur}
        onPaidChange={onPaidChange}
        {...overrides}
      />
    </MemoryRouter>,
  )

  return { onPlannedBlur, onAmountDueBlur, onPaidChange }
}

describe("BillsTable expandable bill groups", () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
      clear: () => {
        storage.clear()
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("renders ungrouped individuals before the Utilities group parent (BGRP-10)", () => {
    renderBillsTable()

    const gas = screen.getByText("Gas")
    const aaa = screen.getByText("AAA Ungrouped")
    const utilities = screen.getByText("Utilities")

    expect(gas.compareDocumentPosition(utilities)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(aaa.compareDocumentPosition(utilities)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it("hides visible group children when collapsed and reveals them on expand (BGRP-11)", async () => {
    renderBillsTable()

    expect(screen.queryByText("Electric")).toBeNull()
    expect(screen.queryByText("Water")).toBeNull()

    fireEvent.click(
      screen.getByRole("button", { name: "Expand Utilities bills" }),
    )

    await waitFor(() => {
      expect(screen.getByText("Electric")).toBeTruthy()
      expect(screen.getByText("Water")).toBeTruthy()
    })
  })

  it("shows aggregated due and paid on parent without inputs or checkbox (BGRP-12)", () => {
    renderBillsTable()

    const utilitiesRow = screen.getByText("Utilities").closest("tr")
    expect(utilitiesRow).not.toBeNull()
    const row = utilitiesRow!

    expect(within(row).getAllByText("125.25").length).toBeGreaterThan(0)
    expect(within(row).getByText("1/2")).toBeTruthy()
    expect(within(row).queryByRole("checkbox")).toBeNull()
    expect(within(row).queryByRole("textbox")).toBeNull()
  })

  it("keeps subtotal testids unchanged when expanding (BGRP-14 / D-06)", async () => {
    renderBillsTable()

    const dueBefore = screen.getByTestId("bills-due-subtotal").textContent
    const plannedBefore = screen.getByTestId("bills-planned-cash-subtotal").textContent

    fireEvent.click(
      screen.getByRole("button", { name: "Expand Utilities bills" }),
    )

    await waitFor(() => {
      expect(screen.getByText("Electric")).toBeTruthy()
    })

    expect(screen.getByTestId("bills-due-subtotal").textContent).toBe(dueBefore)
    expect(screen.getByTestId("bills-planned-cash-subtotal").textContent).toBe(
      plannedBefore,
    )
  })

  it("toggles chevron aria-expanded on button activation (BGRP-14)", async () => {
    renderBillsTable()

    const chevron = screen.getByRole("button", { name: "Expand Utilities bills" })
    expect(chevron.getAttribute("aria-expanded")).toBe("false")

    chevron.focus()
    expect(document.activeElement).toBe(chevron)
    fireEvent.click(chevron)

    await waitFor(() => {
      expect(chevron.getAttribute("aria-expanded")).toBe("true")
    })

    expect(
      JSON.parse(storage.get(STORAGE_KEY) ?? "[]"),
    ).toContain("utilities")
  })

  it("links group parent Actions to bill groups hub (BGRP-18)", () => {
    renderBillsTable()

    const manageLink = screen.getByRole("link", { name: "Manage group" })
    expect(manageLink.getAttribute("href")).toBe(
      "/manage/payment-run/bill-groups?group=utilities",
    )
  })

  it("links per-row Manage to bill detail, not Bills hub", async () => {
    renderBillsTable()

    fireEvent.click(
      screen.getByRole("button", { name: "Expand Utilities bills" }),
    )

    await waitFor(() => {
      expect(screen.getByText("Electric")).toBeTruthy()
    })

    const manageLink = screen.getByRole("link", { name: "Manage Electric" })
    expect(manageLink.getAttribute("href")).toBe("/manage/bills/1")
  })
})

const forecastPayload: BillForecast = {
  month: "2026-07",
  likelihood: "likely",
  suggested_amount: "405.00",
  basis: "mean_last_n",
  n: 2,
  lookback_months: 12,
  seasonal: {
    detected: true,
    active_months: [10, 11, 12, 1, 2, 3],
    active_month_labels: "Oct–Mar",
  },
  cadence_label: "seasonal",
  last_payment_date: "2026-03-10",
  note: "Advisory — verify before planning",
}

function renderForecastBillsTable(rows: BillRow[]) {
  const onPlannedBlur = vi.fn(async () => {})
  const onAmountDueBlur = vi.fn(async () => {})
  const onPaidChange = vi.fn(async () => {})

  render(
    <MemoryRouter>
      <TooltipProvider>
        <BillsTable
          rows={rows}
          billGroups={[]}
          buckets={[
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
          ]}
          creditCards={[]}
          subtotals={{ owed: "0.00", due: "405.00", planned_cash: "0.00" }}
          onPlannedBlur={onPlannedBlur}
          onAmountDueBlur={onAmountDueBlur}
          onPaidChange={onPaidChange}
        />
      </TooltipProvider>
    </MemoryRouter>,
  )
}

describe("BillsTable intermittent forecast Due UX", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("keeps muted intermittent row with forecast due and sky emphasis ring", () => {
    renderForecastBillsTable([
      makeBill({
        registry_id: 50,
        row_key: "bills:50",
        row_label: "Heating Oil",
        amount_mode: "intermittent",
        amount_due: "405.00",
        amount_due_source: "forecast",
        planned_amount: "0.00",
        forecast: forecastPayload,
      }),
    ])

    const row = screen.getByText("Heating Oil").closest("tr")
    expect(row?.getAttribute("data-state")).toBe("muted-intermittent")
    expect(screen.getByTestId("forecast-due-emphasis")).toBeTruthy()
    const trigger = screen.getByTestId("forecast-due-tooltip-trigger")
    expect(trigger).toBeTruthy()
    expect(trigger.tagName).toBe("DIV")
    expect(trigger.getAttribute("aria-label")).toContain(
      "Advisory — verify before planning",
    )
    const dueInput = within(trigger).getByRole("textbox")
    expect(dueInput).toBeTruthy()
    expect(trigger.contains(dueInput)).toBe(true)
    expect(dueInput.closest("button")).toBeNull()
  })

  it("shows posted actual without ring but includes Suggested in tooltip", () => {
    renderForecastBillsTable([
      makeBill({
        registry_id: 51,
        row_key: "bills:51",
        row_label: "Heating Oil Posted",
        amount_mode: "intermittent",
        amount_due: "350.00",
        amount_due_source: "posted",
        planned_amount: "0.00",
        forecast: { ...forecastPayload, posted_wins: true },
      }),
    ])

    expect(screen.queryByTestId("forecast-due-emphasis")).toBeNull()
    expect(screen.getByTestId("forecast-due-tooltip-trigger")).toBeTruthy()
    const trigger = screen.getByTestId("forecast-due-tooltip-trigger")
    expect(trigger.getAttribute("aria-label")).toContain("405.00")
  })

  it("renders unknown intermittent soft due without forecast chrome", () => {
    renderForecastBillsTable([
      makeBill({
        registry_id: 52,
        row_key: "bills:52",
        row_label: "Sparse Bill",
        amount_mode: "intermittent",
        amount_due: "0.00",
        amount_due_source: "none",
        planned_amount: "0.00",
      }),
    ])

    expect(screen.queryByTestId("forecast-due-emphasis")).toBeNull()
    expect(screen.queryByTestId("forecast-due-tooltip-trigger")).toBeNull()
    const row = screen.getByText("Sparse Bill").closest("tr")
    expect(row?.getAttribute("data-state")).toBe("muted-intermittent")
  })

  it("suppresses forecast ring when operator overrides amount due", () => {
    renderForecastBillsTable([
      makeBill({
        registry_id: 53,
        row_key: "bills:53",
        row_label: "Heating Override",
        amount_mode: "intermittent",
        amount_due: "500.00",
        amount_due_override: true,
        amount_due_source: "override",
        planned_amount: "0.00",
        forecast: forecastPayload,
      }),
    ])

    expect(screen.queryByTestId("forecast-due-emphasis")).toBeNull()
    expect(screen.getByTestId("forecast-due-tooltip-trigger")).toBeTruthy()
  })
})
