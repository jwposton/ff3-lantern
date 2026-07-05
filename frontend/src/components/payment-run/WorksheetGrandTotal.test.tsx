import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { WorksheetGrandTotal } from "./WorksheetGrandTotal"
import type { GrandTotals } from "@/lib/paymentRunApi"

const BASE_TOTALS: GrandTotals = {
  owed: "52000.00",
  due: "675.00",
  planned_cash: "800.00",
  planned_total: "875.00",
  breakdown: {
    owed: {
      liabilities: "50000.00",
      revolving: "2000.00",
      real_estate: "25000.00",
      loans: "25000.00",
    },
    due: {
      cash: "600.00",
      credit: "75.00",
    },
    planned: {
      cash: "800.00",
      credit: "75.00",
    },
    due_planned: {
      liabilities: {
        cash: { due: "500.00", planned: "500.00" },
        credit: { due: "25.00", planned: "25.00" },
      },
      bills: {
        cash: { due: "100.00", planned: "100.00" },
        credit: { due: "50.00", planned: "50.00" },
      },
      credit_card_pmts: {
        cash: { due: "0.00", planned: "200.00" },
        credit: { due: "0.00", planned: "0.00" },
      },
    },
  },
}

describe("WorksheetGrandTotal", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders headline totals", () => {
    render(<WorksheetGrandTotal grandTotals={BASE_TOTALS} />)

    expect(screen.getByTestId("grand-total-owed").textContent).toBe("52,000.00")
    expect(screen.getByTestId("grand-total-due").textContent).toBe("675.00")
    expect(screen.getByTestId("grand-total-planned").textContent).toBe("875.00")
  })

  it("renders collapsible cash and credit groups with child rows", () => {
    render(<WorksheetGrandTotal grandTotals={BASE_TOTALS} />)

    expect(screen.getByTestId("grand-total-cash-due").textContent).toBe("600.00")
    expect(screen.getByTestId("grand-total-credit-due").textContent).toBe("75.00")
    expect(screen.getByTestId("grand-total-liabilities-cash-due").textContent).toBe(
      "500.00",
    )
    expect(screen.getByTestId("grand-total-liabilities-credit-due").textContent).toBe(
      "25.00",
    )
    expect(screen.getByTestId("grand-total-bills-cash-due").textContent).toBe(
      "100.00",
    )
    expect(screen.getByTestId("grand-total-bills-credit-due").textContent).toBe(
      "50.00",
    )
    expect(
      screen.getByTestId("grand-total-credit-card-pmts-cash-planned").textContent,
    ).toBe("200.00")
  })

  it("hides all-zero child rows and collapsible parent groups", () => {
    const totals: GrandTotals = {
      ...BASE_TOTALS,
      due: "600.00",
      planned_total: "800.00",
      breakdown: {
        ...BASE_TOTALS.breakdown,
        due: { cash: "600.00", credit: "0.00" },
        planned: { cash: "800.00", credit: "0.00" },
        due_planned: {
          liabilities: {
            cash: { due: "500.00", planned: "500.00" },
            credit: { due: "0.00", planned: "0.00" },
          },
          bills: {
            cash: { due: "100.00", planned: "100.00" },
            credit: { due: "0.00", planned: "0.00" },
          },
          credit_card_pmts: {
            cash: { due: "0.00", planned: "200.00" },
            credit: { due: "0.00", planned: "0.00" },
          },
        },
      },
    }

    render(<WorksheetGrandTotal grandTotals={totals} />)

    expect(screen.queryByTestId("grand-total-credit-due")).toBeNull()
    expect(screen.queryByTestId("grand-total-liabilities-credit-due")).toBeNull()
    expect(screen.queryByTestId("grand-total-bills-credit-due")).toBeNull()
  })

  it("collapses owed and due groups when toggled", () => {
    render(<WorksheetGrandTotal grandTotals={BASE_TOTALS} />)

    expect(screen.getByTestId("grand-total-real-estate-owed")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Liabilities" }))
    expect(screen.queryByTestId("grand-total-real-estate-owed")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Cash (bank)" }))
    expect(screen.queryByTestId("grand-total-bills-cash-due")).toBeNull()
  })

  it("omits real estate row when absent from breakdown", () => {
    const totals: GrandTotals = {
      ...BASE_TOTALS,
      breakdown: {
        ...BASE_TOTALS.breakdown,
        owed: {
          liabilities: "5000.00",
          revolving: "0.00",
          loans: "5000.00",
        },
      },
    }

    render(<WorksheetGrandTotal grandTotals={totals} />)

    expect(screen.queryByTestId("grand-total-real-estate-owed")).toBeNull()
    expect(screen.getByTestId("grand-total-loans-owed").textContent).toBe(
      "5,000.00",
    )
  })
})
