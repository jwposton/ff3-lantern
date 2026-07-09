import type { ExternalLinkDependents } from "./paymentRunApi"

const SECTION_KEYS = ["bills", "liabilities", "buckets", "accounts"] as const

type DependentSectionKey = (typeof SECTION_KEYS)[number]

export function externalLinkDependentsTotal(
  dependents: ExternalLinkDependents,
): number {
  if (typeof dependents.total === "number") {
    return dependents.total
  }
  return SECTION_KEYS.reduce(
    (sum, key) => sum + (dependents[key] ?? 0),
    0,
  )
}

function formatSectionCount(count: number, label: string): string {
  const noun = count === 1 ? label : `${label}s`
  return `${count} ${noun}`
}

export function formatDependentsBreakdown(
  dependents: ExternalLinkDependents,
): string {
  const parts: string[] = []
  if (dependents.bills) {
    parts.push(formatSectionCount(dependents.bills, "bill"))
  }
  if (dependents.liabilities) {
    parts.push(formatSectionCount(dependents.liabilities, "liability"))
  }
  if (dependents.buckets) {
    parts.push(formatSectionCount(dependents.buckets, "bucket"))
  }
  if (dependents.accounts) {
    parts.push(formatSectionCount(dependents.accounts, "account"))
  }
  return parts.join(" · ")
}

export function formatPortalHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

const HUB_PATHS: Record<DependentSectionKey, string> = {
  bills: "/manage/bills",
  liabilities: "/manage/bills",
  buckets: "/manage/payment-run/buckets",
  accounts: "/manage/payment-run/cards",
}

export function dependentsHubPath(key: DependentSectionKey): string {
  return HUB_PATHS[key]
}
