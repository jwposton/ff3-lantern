import { describe, expect, it } from "vitest"

import type { BillRow, WorksheetBillGroupSummary } from "./paymentRunApi"
import {
  aggregateGroupParent,
  deriveWorksheetBillRows,
} from "./worksheetBillGroups"

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

describe("deriveWorksheetBillRows", () => {
  it("renders singleton group as individual rows with no group_parent", () => {
    const group = makeGroup({ id: "solo-group", label: "Solo", member_count: 1, visible_count: 1 })
    const solo = makeBill({
      registry_id: 1,
      row_key: "bills:1",
      bill_group_id: "solo-group",
      show_in_group: true,
    })
    const ungrouped = makeBill({
      registry_id: 2,
      row_key: "bills:2",
      bill_group_id: null,
    })

    const derived = deriveWorksheetBillRows("bills", [solo, ungrouped], [group])

    expect(derived.filter((r) => r.kind === "group_parent")).toHaveLength(0)
    expect(derived.filter((r) => r.kind === "individual")).toHaveLength(2)
    expect(derived.filter((r) => r.kind === "group_child")).toHaveLength(0)
  })

  it("emits group_parent and group_child rows after ungrouped block for two visible children", () => {
    const group = makeGroup({
      id: "utilities",
      label: "Utilities",
      sort_order: 1,
      member_count: 3,
      visible_count: 2,
    })
    const ungrouped = makeBill({
      registry_id: 10,
      row_key: "bills:10",
      row_label: "AAA Ungrouped",
      bill_group_id: null,
    })
    const visible1 = makeBill({
      registry_id: 1,
      row_key: "bills:1",
      row_label: "Electric",
      bill_group_id: "utilities",
      show_in_group: true,
    })
    const visible2 = makeBill({
      registry_id: 2,
      row_key: "bills:2",
      row_label: "Water",
      bill_group_id: "utilities",
      show_in_group: true,
    })
    const hidden = makeBill({
      registry_id: 3,
      row_key: "bills:3",
      row_label: "Gas",
      bill_group_id: "utilities",
      show_in_group: false,
    })

    const derived = deriveWorksheetBillRows(
      "bills",
      [visible1, visible2, hidden, ungrouped],
      [group],
    )

    const parentIdx = derived.findIndex((r) => r.kind === "group_parent")
    const firstIndividualIdx = derived.findIndex((r) => r.kind === "individual")
    expect(firstIndividualIdx).toBeLessThan(parentIdx)
    expect(derived.filter((r) => r.kind === "group_parent")).toHaveLength(1)
    expect(derived.filter((r) => r.kind === "group_child")).toHaveLength(3)
    expect(derived.filter((r) => r.kind === "individual")).toHaveLength(1)
  })

  it("does not emit parent for empty group definition", () => {
    const emptyGroup = makeGroup({
      id: "empty-group",
      label: "Empty",
      member_count: 0,
      visible_count: 0,
    })
    const ungrouped = makeBill({
      registry_id: 1,
      row_key: "bills:1",
      bill_group_id: null,
    })

    const derived = deriveWorksheetBillRows("bills", [ungrouped], [emptyGroup])

    expect(derived.filter((r) => r.kind === "group_parent")).toHaveLength(0)
    expect(derived.filter((r) => r.kind === "individual")).toHaveLength(1)
  })

  it("renders all-hidden group members as individuals only", () => {
    const group = makeGroup({
      id: "hidden-group",
      label: "Hidden",
      member_count: 2,
      visible_count: 0,
    })
    const hidden1 = makeBill({
      registry_id: 1,
      row_key: "bills:1",
      bill_group_id: "hidden-group",
      show_in_group: false,
    })
    const hidden2 = makeBill({
      registry_id: 2,
      row_key: "bills:2",
      bill_group_id: "hidden-group",
      show_in_group: false,
    })

    const derived = deriveWorksheetBillRows("bills", [hidden1, hidden2], [group])

    expect(derived.filter((r) => r.kind === "group_parent")).toHaveLength(0)
    expect(derived.filter((r) => r.kind === "group_child")).toHaveLength(0)
    expect(derived.filter((r) => r.kind === "individual")).toHaveLength(2)
  })

  it("treats dormant show_in_group with null bill_group_id as individual", () => {
    const dormant = makeBill({
      registry_id: 1,
      row_key: "bills:1",
      bill_group_id: null,
      show_in_group: true,
    })

    const derived = deriveWorksheetBillRows("bills", [dormant], [])

    expect(derived).toHaveLength(1)
    expect(derived[0]?.kind).toBe("individual")
  })

  it("places singleton at natural sort position among ungrouped rows", () => {
    const group = makeGroup({
      id: "solo-sort",
      label: "Solo Sort",
      member_count: 1,
      visible_count: 1,
    })
    const solo = makeBill({
      registry_id: 2,
      row_key: "bills:2",
      row_label: "Middle Bill",
      bill_group_id: "solo-sort",
      show_in_group: true,
    })
    const before = makeBill({
      registry_id: 1,
      row_key: "bills:1",
      row_label: "Alpha Bill",
      bill_group_id: null,
    })
    const after = makeBill({
      registry_id: 3,
      row_key: "bills:3",
      row_label: "Zulu Bill",
      bill_group_id: null,
    })

    const derived = deriveWorksheetBillRows("bills", [after, solo, before], [group])
    const individuals = derived.filter((r) => r.kind === "individual")
    const labels = individuals.map((r) =>
      r.kind === "individual" ? r.row.row_label : "",
    )

    expect(labels).toEqual(["Alpha Bill", "Middle Bill", "Zulu Bill"])
    expect(derived.some((r) => r.kind === "group_parent")).toBe(false)
  })

  it("filters rows by section and ignores cross-section group members defensively", () => {
    const group = makeGroup({
      id: "cross-section",
      label: "Cross",
      member_count: 2,
      visible_count: 2,
    })
    const billsMember = makeBill({
      registry_id: 1,
      row_key: "bills:1",
      worksheet_section: "bills",
      bill_group_id: "cross-section",
      show_in_group: true,
    })
    const liabilitiesMember = makeBill({
      registry_id: 2,
      row_key: "liabilities:2",
      worksheet_section: "liabilities",
      bill_group_id: "cross-section",
      show_in_group: true,
    })

    const derived = deriveWorksheetBillRows(
      "liabilities",
      [billsMember, liabilitiesMember],
      [group],
    )

    expect(derived.filter((r) => r.kind === "group_parent")).toHaveLength(0)
    expect(derived.filter((r) => r.kind === "individual")).toHaveLength(1)
    expect(derived[0]?.kind).toBe("individual")
    if (derived[0]?.kind === "individual") {
      expect(derived[0].row.worksheet_section).toBe("liabilities")
    }
  })
})

describe("aggregateGroupParent", () => {
  it("sums amount_due and planned_amount when children share rail and bucket", () => {
    const children = [
      makeBill({
        registry_id: 1,
        row_key: "bills:1",
        amount_due: "50.00",
        planned_amount: "50.00",
        payment_rail: "bank",
        funding_bucket_key: "checking",
        show_in_group: true,
      }),
      makeBill({
        registry_id: 2,
        row_key: "bills:2",
        amount_due: "75.25",
        planned_amount: "75.25",
        payment_rail: "bank",
        funding_bucket_key: "checking",
        show_in_group: true,
      }),
    ]

    const agg = aggregateGroupParent(children)

    expect(agg.amount_due).toBe("125.25")
    expect(agg.planned_amount).toBe("125.25")
    expect(agg.payment_rail).toBe("bank")
    expect(agg.funding_bucket_key).toBe("checking")
  })

  it("returns Mixed for payment_rail when children differ", () => {
    const children = [
      makeBill({
        registry_id: 1,
        row_key: "bills:1",
        payment_rail: "bank",
        show_in_group: true,
      }),
      makeBill({
        registry_id: 2,
        row_key: "bills:2",
        payment_rail: "credit_card",
        show_in_group: true,
      }),
    ]

    expect(aggregateGroupParent(children).payment_rail).toBe("Mixed")
  })

  it("returns Mixed for funding_bucket_key when children differ", () => {
    const children = [
      makeBill({
        registry_id: 1,
        row_key: "bills:1",
        funding_bucket_key: "checking",
        show_in_group: true,
      }),
      makeBill({
        registry_id: 2,
        row_key: "bills:2",
        funding_bucket_key: "savings",
        show_in_group: true,
      }),
    ]

    expect(aggregateGroupParent(children).funding_bucket_key).toBe("Mixed")
  })

  it("shows partial paid count over visible children", () => {
    const children = [
      makeBill({
        registry_id: 1,
        row_key: "bills:1",
        paid_at: "2026-07-01T00:00:00Z",
        show_in_group: true,
      }),
      makeBill({
        registry_id: 2,
        row_key: "bills:2",
        paid_at: null,
        show_in_group: true,
      }),
      makeBill({
        registry_id: 3,
        row_key: "bills:3",
        paid_at: null,
        show_in_group: true,
      }),
    ]

    expect(aggregateGroupParent(children).paid).toBe("1/3")
  })
})
