import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  BillRow,
  CreditCardRow,
  FundingBucketRollup,
  LiabilityRow,
  PaymentWorksheetEnvelope,
  ResolvedExternalLink,
  WorksheetBillGroupSummary,
} from "./paymentRunApi"
import {
  OPEN_ALL_WARN_THRESHOLD,
  collectOpenAllPortalUrls,
  openPortalUrls,
} from "./portalLinkWorksheet"

function makeLink(
  id: string,
  url: string,
  label = `Link ${id}`,
): ResolvedExternalLink {
  return { id, label, url }
}

function makeBucket(
  overrides: Partial<FundingBucketRollup> & Pick<FundingBucketRollup, "id">,
): FundingBucketRollup {
  return {
    label: overrides.id,
    sort_order: 0,
    reported_balance: "0",
    user_balance: "0",
    user_balance_override: false,
    planned_outflows: "0",
    remaining: "0",
    ...overrides,
  }
}

function makeCard(
  overrides: Partial<CreditCardRow> & Pick<CreditCardRow, "account_id">,
): CreditCardRow {
  return {
    name: overrides.account_id,
    credit_limit: null,
    funding_bucket_key: null,
    default_planned_payment: null,
    payment_due_day: null,
    apr_percent: null,
    owed: "0",
    new_total: "0",
    interest_accrued: "0",
    fees: "0",
    last_payment_date: null,
    last_payment_amount: "0",
    new_transactions: [],
    planned_amount: "0",
    planned_amount_override: false,
    paid_at: null,
    row_key: `cc:${overrides.account_id}`,
    ...overrides,
  }
}

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

function makeLiability(
  overrides: Partial<LiabilityRow> & Pick<LiabilityRow, "row_key">,
): LiabilityRow {
  return {
    paid_at: null,
    est_interest: null,
    remaining_payments: null,
    funding_bucket_key: null,
    planned_amount: "0",
    planned_amount_override: false,
    amount_due: "0",
    amount_due_override: false,
    worksheet_section: "liabilities",
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

function makeWorksheet(
  overrides: Partial<PaymentWorksheetEnvelope> = {},
): PaymentWorksheetEnvelope {
  return {
    month: "2026-07",
    refreshed_at: null,
    buckets: [],
    credit_cards: [],
    excluded_credit_cards: [],
    bills: [],
    liabilities: [],
    excluded_liabilities: [],
    bill_groups: [],
    section_subtotals: {
      bills: { owed: "0", due: "0", planned_cash: "0" },
      liabilities: { owed: "0", due: "0", planned_cash: "0" },
      credit_cards: { planned_cash: "0" },
    },
    grand_totals: {
      owed: { liabilities: "0", revolving: "0" },
      due: { cash: "0", credit: "0" },
      planned: { cash: "0", credit: "0" },
      due_planned: {
        liabilities: { cash: { due: "0", planned: "0" }, credit: { due: "0", planned: "0" } },
        bills: { cash: { due: "0", planned: "0" }, credit: { due: "0", planned: "0" } },
        credit_cards: { cash: { due: "0", planned: "0" }, credit: { due: "0", planned: "0" } },
      },
    },
    shortfall: false,
    totals: { reported_balance: "0", user_balance: "0", remaining: "0" },
    ...overrides,
  }
}

describe("collectOpenAllPortalUrls", () => {
  it("collects URLs in banking → CC → bills → liabilities order", () => {
    const worksheet = makeWorksheet({
      buckets: [
        makeBucket({
          id: "checking",
          external_link: makeLink("b1", "https://bank.example.com"),
        }),
      ],
      credit_cards: [
        makeCard({
          account_id: "cc-1",
          sort_order: 1,
          external_link: makeLink("c1", "https://card.example.com"),
        }),
      ],
      bills: [
        makeBill({
          registry_id: 1,
          row_key: "bills:1",
          external_link: makeLink("bill1", "https://bill.example.com"),
        }),
      ],
      liabilities: [
        makeLiability({
          row_key: "liab:1",
          external_link: makeLink("l1", "https://liability.example.com"),
        }),
      ],
    })

    expect(collectOpenAllPortalUrls(worksheet)).toEqual([
      "https://bank.example.com",
      "https://card.example.com",
      "https://bill.example.com",
      "https://liability.example.com",
    ])
  })

  it("dedupes URLs keeping earliest position", () => {
    const shared = makeLink("shared", "https://shared.example.com")
    const worksheet = makeWorksheet({
      buckets: [makeBucket({ id: "checking", external_link: shared })],
      credit_cards: [
        makeCard({ account_id: "cc-1", external_link: shared }),
      ],
      bills: [
        makeBill({
          registry_id: 1,
          row_key: "bills:1",
          external_link: makeLink("bill-dup", "https://shared.example.com"),
        }),
      ],
    })

    expect(collectOpenAllPortalUrls(worksheet)).toEqual([
      "https://shared.example.com",
    ])
  })

  it("includes collapsed bill-group children via derivation", () => {
    const group = makeGroup({
      id: "utilities",
      label: "Utilities",
      member_count: 2,
      visible_count: 2,
    })
    const child1 = makeBill({
      registry_id: 1,
      row_key: "bills:1",
      bill_group_id: "utilities",
      show_in_group: true,
      external_link: makeLink("u1", "https://electric.example.com"),
    })
    const child2 = makeBill({
      registry_id: 2,
      row_key: "bills:2",
      bill_group_id: "utilities",
      show_in_group: true,
      external_link: makeLink("u2", "https://water.example.com"),
    })

    const worksheet = makeWorksheet({
      bill_groups: [group],
      bills: [child1, child2],
    })

    expect(collectOpenAllPortalUrls(worksheet)).toEqual([
      "https://electric.example.com",
      "https://water.example.com",
    ])
  })

  it("does not filter by paid_at or planned_amount", () => {
    const worksheet = makeWorksheet({
      bills: [
        makeBill({
          registry_id: 1,
          row_key: "bills:1",
          paid_at: "2026-07-01",
          planned_amount: "0",
          external_link: makeLink("paid", "https://paid.example.com"),
        }),
      ],
    })

    expect(collectOpenAllPortalUrls(worksheet)).toEqual([
      "https://paid.example.com",
    ])
  })
})

describe("OPEN_ALL_WARN_THRESHOLD", () => {
  it("equals 15", () => {
    expect(OPEN_ALL_WARN_THRESHOLD).toBe(15)
  })
})

describe("openPortalUrls", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("opens each URL synchronously with noopener,noreferrer", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window)
    const urls = [
      "https://one.example.com",
      "https://two.example.com",
      "https://three.example.com",
    ]

    const count = openPortalUrls(urls)

    expect(count).toBe(3)
    expect(openSpy).toHaveBeenCalledTimes(3)
    expect(openSpy).toHaveBeenNthCalledWith(
      1,
      "https://one.example.com",
      "_blank",
      "noopener,noreferrer",
    )
    expect(openSpy).toHaveBeenNthCalledWith(
      2,
      "https://two.example.com",
      "_blank",
      "noopener,noreferrer",
    )
    expect(openSpy).toHaveBeenNthCalledWith(
      3,
      "https://three.example.com",
      "_blank",
      "noopener,noreferrer",
    )
  })
})
