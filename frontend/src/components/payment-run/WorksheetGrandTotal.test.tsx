import { cleanup, render, screen } from "@testing-library/react"
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
      real_estate: "250000.00",
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
  },
}

describe("WorksheetGrandTotal", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders headline totals and sub-breakdown rows", () => {
    render(<WorksheetGrandTotal grandTotals={BASE_TOTALS} />)

    expect(screen.getByTestId("grand-total-owed").textContent).toBe("52,000.00")
    expect(screen.getByTestId("grand-total-due").textContent).toBe("675.00")
    expect(screen.getByTestId("grand-total-planned").textContent).toBe("875.00")

    expect(screen.getByTestId("grand-total-owed-liabilities").textContent).toBe(
      "50,000.00",
    )
    expect(screen.getByTestId("grand-total-owed-real-estate").textContent).toBe(
      "250,000.00",
    )
    expect(screen.getByTestId("grand-total-owed-loans").textContent).toBe(
      "25,000.00",
    )
    expect(screen.getByTestId("grand-total-owed-revolving").textContent).toBe(
      "2,000.00",
    )
    expect(screen.getByTestId("grand-total-due-cash").textContent).toBe("600.00")
    expect(screen.getByTestId("grand-total-due-credit").textContent).toBe("75.00")
    expect(screen.getByTestId("grand-total-planned-cash").textContent).toBe(
      "800.00",
    )
    expect(screen.getByTestId("grand-total-planned-credit").textContent).toBe(
      "75.00",
    )
  })

  it("omits optional real estate and loans sub-lines when absent", () => {
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

    expect(screen.queryByTestId("grand-total-owed-real-estate")).toBeNull()
    expect(screen.getByTestId("grand-total-owed-loans").textContent).toBe(
      "5,000.00",
    )
  })
})
