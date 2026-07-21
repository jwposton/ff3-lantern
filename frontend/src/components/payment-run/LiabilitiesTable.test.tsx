import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { LiabilitiesTable } from "./LiabilitiesTable"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { LiabilityRow } from "@/lib/paymentRunApi"

const portalLink = {
  id: "liab-portal",
  label: "Lender Portal",
  url: "https://lender.example.com/login",
}

function makeLiabilityRow(
  overrides: Partial<LiabilityRow> & Pick<LiabilityRow, "row_key">,
): LiabilityRow {
  return {
    row_label: "Student Loan",
    registry_id: 5,
    account_id: "acct-1",
    name: "Student Loan",
    firefly_bill_id: null,
    paid_at: null,
    amount_due: "250.00",
    amount_due_override: false,
    planned_amount: "250.00",
    planned_amount_override: false,
    funding_bucket_key: "checking",
    owed: "10000.00",
    est_interest: null,
    remaining_payments: null,
    ...overrides,
  }
}

function renderLiabilitiesTable(rows: LiabilityRow[]) {
  render(
    <MemoryRouter>
      <TooltipProvider>
        <LiabilitiesTable
          rows={rows}
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
          subtotals={{ owed: "10000.00", due: "250.00", planned_cash: "250.00" }}
          onPlannedBlur={vi.fn(async () => {})}
          onAmountDueBlur={vi.fn(async () => {})}
          onPaidChange={vi.fn(async () => {})}
        />
      </TooltipProvider>
    </MemoryRouter>,
  )
}

describe("LiabilitiesTable portal anchors", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows portal anchor when external_link is set", () => {
    renderLiabilitiesTable([
      makeLiabilityRow({
        row_key: "liabilities:acct-1",
        external_link: portalLink,
      }),
    ])

    const portal = screen.getByTestId("portal-link-liab-portal")
    expect(portal.getAttribute("href")).toBe("https://lender.example.com/login")
    expect(portal.getAttribute("aria-label")).toContain("Student Loan")
  })

  it("hides portal anchor when external_link is null", () => {
    renderLiabilitiesTable([
      makeLiabilityRow({
        row_key: "liabilities:acct-1",
        external_link: null,
      }),
    ])

    expect(screen.queryByTestId(/^portal-link-/)).toBeNull()
  })

  it("renders portal before pencil in Actions cell", () => {
    renderLiabilitiesTable([
      makeLiabilityRow({
        row_key: "liabilities:acct-1",
        external_link: portalLink,
      }),
    ])

    const portal = screen.getByTestId("portal-link-liab-portal")
    const actionsCell = portal.closest("td")
    expect(actionsCell).not.toBeNull()
    const pencil = within(actionsCell!).getByRole("link", {
      name: "Manage Student Loan",
    })
    expect(
      portal.compareDocumentPosition(pencil) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
