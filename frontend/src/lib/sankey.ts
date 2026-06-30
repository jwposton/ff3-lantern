import type { OmniRow } from "@/types/NormalizedTransaction"

import { isBankAccount, isCreditCard } from "@/lib/accounts"

const UNCategorized_LABEL = "Uncategorized"

export const MAX_VISIBLE_BANKS = 8
export const OTHER_BANKS_KEY = "Other Banks_BANK"
export const OTHER_BANKS_LABEL = "Other Banks"

export type SankeyNode = { name: string; displayName: string }
export type SankeyLink = { source: string; target: string; value: number }
export type SankeyData = { nodes: SankeyNode[]; links: SankeyLink[] }

export type FlowType =
  | "source-budget-category"
  | "source-budget-category-payee"
  | "source-category-payee"
  | "source-budget-payee"

export type SelectedSankeyNode = {
  name: string
  type: "Budget" | "Category" | "Payee" | "Account" | "AccountType"
  displayName: string
}

export type SelectedCashFlowNode = {
  name: string
  type: "Bank" | "Budget" | "Category" | "Source"
  displayName: string
}

function parseAmount(amount: string | null): number {
  if (amount == null) return 0
  return parseFloat(amount)
}

function budgetLabel(budget: string | null): string {
  if (budget == null || budget === "") return UNCategorized_LABEL
  return budget
}

function categoryLabel(category: string | null): string {
  if (category == null || category === "") return UNCategorized_LABEL
  return category
}

function cashFlowBudgetOut(tx: OmniRow, destVal: string): string {
  const budget = tx.budget
  if (budget != null && budget !== "") return budget
  if (isCreditCard(tx.destination_type, tx.destination_role)) {
    return "Credit Card Payment"
  }
  return destVal || UNCategorized_LABEL
}

function cashFlowCategoryOut(tx: OmniRow, destVal: string): string {
  const category = tx.category
  if (category != null && category !== "") return category
  if (isCreditCard(tx.destination_type, tx.destination_role)) {
    return destVal ? `${destVal} Payment` : UNCategorized_LABEL
  }
  return destVal || UNCategorized_LABEL
}

function payeeLabel(row: OmniRow): string {
  const name = (row.destination_account ?? "").trim()
  return name || "Unknown Payee"
}

export function computeTopCategoryNames(
  rows: OmniRow[],
  maxCategories: number,
): Set<string> {
  const catTotals: Record<string, number> = {}
  for (const r of rows) {
    const amount = parseAmount(r.amount)
    if (!amount) continue
    const cat = categoryLabel(r.category)
    catTotals[cat] = (catTotals[cat] ?? 0) + amount
  }
  return new Set(
    Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxCategories)
      .map(([name]) => name),
  )
}

function mergeLinks(links: SankeyLink[]): SankeyLink[] {
  const linkMap = new Map<string, number>()
  for (const l of links) {
    const key = `${l.source}→${l.target}`
    linkMap.set(key, (linkMap.get(key) ?? 0) + l.value)
  }
  return Array.from(linkMap.entries()).map(([key, value]) => {
    const [source, target] = key.split("→")
    return { source, target, value }
  })
}

export function isCashMovementRow(row: OmniRow): boolean {
  const sourceIsBank = isBankAccount(row.source_type, row.source_role)
  const destIsBank = isBankAccount(row.destination_type, row.destination_role)
  if (sourceIsBank && destIsBank) return false
  if (!sourceIsBank && !destIsBank) return false
  return true
}

export function countDistinctBankAccounts(rows: OmniRow[]): number {
  const banks = new Set<string>()
  for (const tx of rows) {
    if (!isCashMovementRow(tx)) continue
    const sourceIsBank = isBankAccount(tx.source_type, tx.source_role)
    const destIsBank = isBankAccount(tx.destination_type, tx.destination_role)
    const sourceVal = (tx.source_account ?? "").trim()
    const destVal = (tx.destination_account ?? "").trim()
    if (sourceIsBank && sourceVal) banks.add(sourceVal)
    if (destIsBank && destVal) banks.add(destVal)
  }
  return banks.size
}

export function shouldBucketBanks(rows: OmniRow[]): boolean {
  return countDistinctBankAccounts(rows) > MAX_VISIBLE_BANKS
}

function collectBankVolumes(rows: OmniRow[]): Map<string, number> {
  const volumes = new Map<string, number>()
  for (const tx of rows) {
    const amount = parseAmount(tx.amount)
    if (!amount) continue
    const sourceIsBank = isBankAccount(tx.source_type, tx.source_role)
    const destIsBank = isBankAccount(tx.destination_type, tx.destination_role)
    if ((sourceIsBank && destIsBank) || (!sourceIsBank && !destIsBank)) continue

    const sourceVal = (tx.source_account ?? "").trim()
    const destVal = (tx.destination_account ?? "").trim()
    if (sourceIsBank && sourceVal) {
      const key = `${sourceVal}_BANK`
      volumes.set(key, (volumes.get(key) ?? 0) + amount)
    }
    if (destIsBank && destVal) {
      const key = `${destVal}_BANK`
      volumes.set(key, (volumes.get(key) ?? 0) + amount)
    }
  }
  return volumes
}

function computeTopBankKeys(rows: OmniRow[]): Set<string> | null {
  const volumes = collectBankVolumes(rows)
  if (volumes.size <= MAX_VISIBLE_BANKS) return null
  return new Set(
    [...volumes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_VISIBLE_BANKS)
      .map(([key]) => key),
  )
}

function resolveBankNode(
  accountName: string,
  aggregateBanks: boolean,
  topBankKeys: Set<string> | null,
): { key: string; label: string } {
  if (aggregateBanks) {
    return { key: "BankAccounts_BANK", label: "Bank Accounts" }
  }
  const individualKey = `${accountName}_BANK`
  if (topBankKeys && !topBankKeys.has(individualKey)) {
    return { key: OTHER_BANKS_KEY, label: OTHER_BANKS_LABEL }
  }
  return { key: individualKey, label: accountName }
}

export function sankeyChartHeight(nodeCount: number): number {
  return 540 + Math.max(0, Math.min(1000, (nodeCount - 12) * 32))
}

export function buildSpendingSankeyData(
  rows: OmniRow[],
  flowType: FlowType,
  maxCategories?: number,
): SankeyData {
  const nodeMap = new Map<string, SankeyNode>()
  const linkMap = new Map<string, number>()

  function addNode(name: string, displayName?: string) {
    if (!name) return
    if (!nodeMap.has(name)) {
      nodeMap.set(name, { name, displayName: displayName ?? name })
    }
  }

  function addLink(source: string, target: string, value: number) {
    if (!source || !target || !value) return
    const key = `${source}→${target}`
    linkMap.set(key, (linkMap.get(key) ?? 0) + value)
  }

  for (const r of rows) {
    const amount = parseAmount(r.amount)
    if (!amount) continue

    if (r.source_account) {
      addNode(`${r.source_account} (A)`, r.source_account)
    }

    const budget = budgetLabel(r.budget)
    const category = categoryLabel(r.category)
    const payee = payeeLabel(r)

    if (flowType === "source-budget-category") {
      if (!r.source_account) continue
      addNode(`${budget} (B)`, budget)
      addNode(`${category} (C)`, category)
      addLink(`${r.source_account} (A)`, `${budget} (B)`, amount)
      addLink(`${budget} (B)`, `${category} (C)`, amount)
    } else if (flowType === "source-category-payee") {
      if (!r.source_account) continue
      addNode(`${category} (C)`, category)
      addNode(`${payee} (P)`, payee)
      addLink(`${r.source_account} (A)`, `${category} (C)`, amount)
      addLink(`${category} (C)`, `${payee} (P)`, amount)
    } else if (flowType === "source-budget-payee") {
      if (!r.source_account) continue
      addNode(`${budget} (B)`, budget)
      addNode(`${payee} (P)`, payee)
      addLink(`${r.source_account} (A)`, `${budget} (B)`, amount)
      addLink(`${budget} (B)`, `${payee} (P)`, amount)
    } else if (flowType === "source-budget-category-payee") {
      if (!r.source_account) continue
      addNode(`${budget} (B)`, budget)
      addNode(`${category} (C)`, category)
      addNode(`${payee} (P)`, payee)
      addLink(`${r.source_account} (A)`, `${budget} (B)`, amount)
      addLink(`${budget} (B)`, `${category} (C)`, amount)
      addLink(`${category} (C)`, `${payee} (P)`, amount)
    }
  }

  let nodes = Array.from(nodeMap.values())
  let links = Array.from(linkMap.entries()).map(([key, value]) => {
    const [source, target] = key.split("→")
    return { source, target, value }
  })

  if (
    typeof maxCategories === "number" &&
    maxCategories > 0 &&
    flowType === "source-budget-category"
  ) {
    const catNodes = nodes.filter((n) => n.name.endsWith("(C)"))
    if (catNodes.length > maxCategories) {
      const catTotals: Record<string, number> = {}
      links.forEach((l) => {
        if (l.target.endsWith("(C)")) {
          catTotals[l.target] = (catTotals[l.target] ?? 0) + l.value
        }
      })

      const topCatKeys = new Set(
        [...catNodes]
          .sort((a, b) => (catTotals[b.name] ?? 0) - (catTotals[a.name] ?? 0))
          .slice(0, maxCategories)
          .map((cat) => cat.name),
      )

      const OTHER_CAT = "Other (C)"
      const OTHER_CAT_DISPLAY = "Other"

      const filteredNodes = [
        ...nodes.filter(
          (n) => !n.name.endsWith("(C)") || topCatKeys.has(n.name),
        ),
        { name: OTHER_CAT, displayName: OTHER_CAT_DISPLAY },
      ]

      const filteredLinks: SankeyLink[] = []

      links.forEach((l) => {
        if (l.target.endsWith("(C)") && !topCatKeys.has(l.target)) {
          filteredLinks.push({
            source: l.source,
            target: OTHER_CAT,
            value: l.value,
          })
        } else if (l.source.endsWith("(C)") && !topCatKeys.has(l.source)) {
          filteredLinks.push({
            source: OTHER_CAT,
            target: l.target,
            value: l.value,
          })
        } else if (
          (l.source.endsWith("(C)") && topCatKeys.has(l.source)) ||
          (l.target.endsWith("(C)") && topCatKeys.has(l.target)) ||
          (!l.source.endsWith("(C)") && !l.target.endsWith("(C)"))
        ) {
          filteredLinks.push(l)
        }
      })

      return { nodes: filteredNodes, links: mergeLinks(filteredLinks) }
    }
  }

  return { nodes, links }
}

export function buildCashFlowSankeyData(
  rows: OmniRow[],
  aggregateBanks: boolean,
): SankeyData {
  const nodeMap = new Map<string, SankeyNode>()
  const linkMap = new Map<string, number>()
  const topBankKeys = !aggregateBanks ? computeTopBankKeys(rows) : null

  function addNode(key: string, label?: string) {
    if (!key) return
    if (!nodeMap.has(key)) {
      nodeMap.set(key, { name: key, displayName: label ?? key })
    }
  }

  function addLink(src: string, dst: string, val: number) {
    if (!src || !dst || !val) return
    const key = `${src}→${dst}`
    linkMap.set(key, (linkMap.get(key) ?? 0) + val)
  }

  function pushNodeIfNotDuplicate(
    arr: { key: string; label: string }[],
    node: { key: string; label: string },
  ) {
    if (arr.length === 0 || arr[arr.length - 1].key !== node.key) {
      arr.push(node)
    }
  }

  for (const tx of rows) {
    const amount = parseAmount(tx.amount)
    if (!amount) continue

    const sourceIsBank = isBankAccount(tx.source_type, tx.source_role)
    const destIsBank = isBankAccount(tx.destination_type, tx.destination_role)

    if ((sourceIsBank && destIsBank) || (!sourceIsBank && !destIsBank)) continue

    const sourceVal = (tx.source_account ?? "").trim()
    const destVal = (tx.destination_account ?? "").trim()
    const budgetOut = cashFlowBudgetOut(tx, destVal)
    const categoryOut = cashFlowCategoryOut(tx, destVal)

    const nodes: { key: string; label: string }[] = []

    if (tx.type === "deposit" && !sourceIsBank && destIsBank) {
      if (sourceVal) nodes.push({ key: `${sourceVal}_SRC`, label: sourceVal })
      if (destVal) {
        nodes.push(resolveBankNode(destVal, aggregateBanks, topBankKeys))
      }
    } else if (
      (tx.type === "withdrawal" && sourceIsBank) ||
      (tx.type === "transfer" && sourceIsBank && !destIsBank)
    ) {
      if (sourceVal) {
        nodes.push(resolveBankNode(sourceVal, aggregateBanks, topBankKeys))
      }

      pushNodeIfNotDuplicate(nodes, {
        key: `${budgetOut}_BUDGET`,
        label: budgetOut,
      })
      pushNodeIfNotDuplicate(nodes, {
        key: `${categoryOut}_CAT`,
        label: categoryOut,
      })
    } else if (tx.type === "transfer" && !sourceIsBank && destIsBank) {
      if (sourceVal) nodes.push({ key: `${sourceVal}_SRC`, label: sourceVal })
      if (destVal) {
        nodes.push(resolveBankNode(destVal, aggregateBanks, topBankKeys))
      }
    }

    for (const n of nodes) addNode(n.key, n.label)

    for (let i = 0; i < nodes.length - 1; i++) {
      addLink(nodes[i].key, nodes[i + 1].key, amount)
    }
  }

  const nodes = Array.from(nodeMap.values())
  const links = Array.from(linkMap.entries()).map(([key, value]) => {
    const [source, target] = key.split("→")
    return { source, target, value }
  })
  return { nodes, links }
}

export function filterRowsForDrilldown(
  rows: OmniRow[],
  selected: SelectedSankeyNode,
  maxCategories?: number,
): OmniRow[] {
  if (selected.type === "AccountType") {
    if (selected.displayName === "Bank Accounts") {
      return rows.filter((r) =>
        isBankAccount(r.source_type, r.source_role),
      )
    }
    if (selected.displayName === "Credit Cards") {
      return rows.filter((r) =>
        isCreditCard(r.source_type, r.source_role),
      )
    }
    return []
  }

  if (selected.type === "Budget") {
    return rows.filter(
      (r) => budgetLabel(r.budget) === selected.displayName,
    )
  }

  if (selected.type === "Category") {
    if (
      selected.name === "Other (C)" &&
      typeof maxCategories === "number" &&
      maxCategories > 0
    ) {
      const topNames = computeTopCategoryNames(rows, maxCategories)
      return rows.filter((r) => !topNames.has(categoryLabel(r.category)))
    }
    return rows.filter(
      (r) => categoryLabel(r.category) === selected.displayName,
    )
  }

  if (selected.type === "Account") {
    return rows.filter(
      (r) => (r.source_account ?? "").trim() === selected.displayName,
    )
  }

  if (selected.type === "Payee") {
    return rows.filter((r) => payeeLabel(r) === selected.displayName)
  }

  return []
}

export function parseCashFlowNodeSelection(
  nodeName: string,
  nodes: SankeyNode[],
): SelectedCashFlowNode | null {
  const displayMap = new Map(nodes.map((n) => [n.name, n.displayName]))
  const displayName = displayMap.get(nodeName) ?? nodeName

  if (nodeName.endsWith("_BUDGET")) {
    return { name: nodeName, type: "Budget", displayName }
  }
  if (nodeName.endsWith("_CAT")) {
    return { name: nodeName, type: "Category", displayName }
  }
  if (nodeName.endsWith("_SRC")) {
    return { name: nodeName, type: "Source", displayName }
  }
  if (nodeName.endsWith("_BANK")) {
    return { name: nodeName, type: "Bank", displayName }
  }
  return null
}

export function filterRowsForCashFlowDrilldown(
  rows: OmniRow[],
  selected: SelectedCashFlowNode,
): OmniRow[] {
  if (selected.type === "Bank") {
    if (selected.name === "BankAccounts_BANK") {
      return rows.filter((r) => {
        const sourceIsBank = isBankAccount(r.source_type, r.source_role)
        const destIsBank = isBankAccount(r.destination_type, r.destination_role)
        return sourceIsBank || destIsBank
      })
    }
    if (selected.name === OTHER_BANKS_KEY) {
      const topKeys = computeTopBankKeys(rows)
      if (!topKeys) return []
      const topNames = new Set(
        [...topKeys].map((k) => k.replace(/_BANK$/, "")),
      )
      return rows.filter((r) => {
        const sourceVal = (r.source_account ?? "").trim()
        const destVal = (r.destination_account ?? "").trim()
        const sourceIsBank = isBankAccount(r.source_type, r.source_role)
        const destIsBank = isBankAccount(r.destination_type, r.destination_role)
        if (sourceIsBank && sourceVal && !topNames.has(sourceVal)) return true
        if (destIsBank && destVal && !topNames.has(destVal)) return true
        return false
      })
    }
    return rows.filter((r) => {
      const sourceVal = (r.source_account ?? "").trim()
      const destVal = (r.destination_account ?? "").trim()
      return (
        sourceVal === selected.displayName || destVal === selected.displayName
      )
    })
  }

  if (selected.type === "Budget") {
    return rows.filter((r) => {
      const destVal = (r.destination_account ?? "").trim()
      return cashFlowBudgetOut(r, destVal) === selected.displayName
    })
  }

  if (selected.type === "Category") {
    return rows.filter((r) => {
      const destVal = (r.destination_account ?? "").trim()
      return cashFlowCategoryOut(r, destVal) === selected.displayName
    })
  }

  if (selected.type === "Source") {
    return rows.filter(
      (r) => (r.source_account ?? "").trim() === selected.displayName,
    )
  }

  return []
}

export function buildCashFlowDrilldownData(
  rows: OmniRow[],
  selected: SelectedCashFlowNode,
  _aggregateBanks?: boolean,
): SankeyData {
  const filtered = filterRowsForCashFlowDrilldown(rows, selected)
  return buildCashFlowSankeyData(filtered, true)
}
