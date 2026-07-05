import type { BillRow, WorksheetBillGroupSummary } from "./paymentRunApi"

export type { WorksheetBillGroupSummary } from "./paymentRunApi"

export type WorksheetSection = "bills" | "liabilities"

export type DerivedWorksheetRow =
  | { kind: "individual"; row: BillRow }
  | { kind: "group_parent"; group: WorksheetBillGroupSummary; children: BillRow[] }
  | { kind: "group_child"; row: BillRow; groupId: string }

export type GroupParentAggregate = {
  amount_due: string
  planned_amount: string
  paid: string
  payment_rail: string
  funding_bucket_key: string
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function billRowDisplaySortKey(row: BillRow): [number, string, number] {
  const rail = (row.payment_rail || "bank").trim()
  const mode = (row.amount_mode || "recurring").trim()
  const isCredit = rail === "credit_card"
  const isIntermittent = mode === "intermittent"
  let group: number
  if (!isCredit && !isIntermittent) {
    group = 0
  } else if (!isCredit && isIntermittent) {
    group = 1
  } else if (isCredit && !isIntermittent) {
    group = 2
  } else {
    group = 3
  }
  const label = (row.row_label || "").toLowerCase()
  return [group, label, row.registry_id]
}

function compareBillRows(a: BillRow, b: BillRow): number {
  const keyA = billRowDisplaySortKey(a)
  const keyB = billRowDisplaySortKey(b)
  for (let i = 0; i < 3; i += 1) {
    const left = keyA[i]!
    const right = keyB[i]!
    if (left < right) return -1
    if (left > right) return 1
  }
  return 0
}

function isUngroupedIndividual(row: BillRow): boolean {
  return row.bill_group_id == null
}

function groupSummaryFrom(
  groupId: string,
  billGroups: WorksheetBillGroupSummary[],
  members: BillRow[],
): WorksheetBillGroupSummary {
  const found = billGroups.find((g) => g.id === groupId)
  if (found) return found
  const visibleCount = members.filter((m) => m.show_in_group).length
  return {
    id: groupId,
    label: groupId,
    sort_order: Number.MAX_SAFE_INTEGER,
    member_count: members.length,
    visible_count: visibleCount,
  }
}

export function deriveWorksheetBillRows(
  section: WorksheetSection,
  rows: BillRow[],
  billGroups: WorksheetBillGroupSummary[],
): DerivedWorksheetRow[] {
  const sectionRows = rows.filter((row) => row.worksheet_section === section)

  const ungroupedIndividuals: BillRow[] = []
  const groupBuckets = new Map<string, BillRow[]>()

  for (const row of sectionRows) {
    if (isUngroupedIndividual(row)) {
      ungroupedIndividuals.push(row)
      continue
    }
    const groupId = row.bill_group_id!
    const bucket = groupBuckets.get(groupId) ?? []
    bucket.push(row)
    groupBuckets.set(groupId, bucket)
  }

  type GroupBlock = {
    groupId: string
    members: BillRow[]
    summary: WorksheetBillGroupSummary
  }
  const groupBlocks: GroupBlock[] = []

  for (const [groupId, members] of groupBuckets) {
    const visible = members.filter((m) => m.show_in_group)
    if (visible.length >= 2) {
      groupBlocks.push({
        groupId,
        members: [...members].sort(compareBillRows),
        summary: groupSummaryFrom(groupId, billGroups, members),
      })
    } else {
      for (const member of members) {
        ungroupedIndividuals.push(member)
      }
    }
  }

  ungroupedIndividuals.sort(compareBillRows)

  groupBlocks.sort((a, b) => {
    if (a.summary.sort_order !== b.summary.sort_order) {
      return a.summary.sort_order - b.summary.sort_order
    }
    return a.summary.label.localeCompare(b.summary.label)
  })

  const result: DerivedWorksheetRow[] = []

  for (const row of ungroupedIndividuals) {
    result.push({ kind: "individual", row })
  }

  for (const block of groupBlocks) {
    result.push({
      kind: "group_parent",
      group: block.summary,
      children: block.members,
    })
    for (const member of block.members) {
      result.push({ kind: "group_child", row: member, groupId: block.groupId })
    }
  }

  return result
}

export function aggregateGroupParent(children: BillRow[]): GroupParentAggregate {
  const visible = children.filter((c) => c.show_in_group)
  let sumDue = 0
  let sumPlanned = 0
  let paidCount = 0
  const rails = new Set<string>()
  const buckets = new Set<string>()

  for (const row of visible) {
    sumDue += parseAmount(row.amount_due)
    sumPlanned += parseAmount(row.planned_amount)
    if (row.paid_at) paidCount += 1
    rails.add(row.payment_rail)
    buckets.add(row.funding_bucket_key ?? "")
  }

  const totalCount = visible.length

  return {
    amount_due: sumDue.toFixed(2),
    planned_amount: sumPlanned.toFixed(2),
    paid: `${paidCount}/${totalCount}`,
    payment_rail: rails.size === 1 ? [...rails][0]! : "Mixed",
    funding_bucket_key: buckets.size === 1 ? [...buckets][0]! : "Mixed",
  }
}
