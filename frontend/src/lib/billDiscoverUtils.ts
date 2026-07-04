import type { BillSuggestion } from "@/lib/paymentRunApi"

export const LOOKBACK_CHOICES = [6, 12, 24] as const

export function parseLookback(raw: string | null): number {
  const n = raw ? Number(raw) : 12
  return (LOOKBACK_CHOICES as readonly number[]).includes(n) ? n : 12
}

export function suggestionPayee(row: BillSuggestion): string {
  return (
    row.payee?.trim() ||
    row.register_prefill.destination_account?.trim() ||
    row.bucket?.trim() ||
    "Unknown payee"
  )
}

export function groupByPayee(
  items: BillSuggestion[],
  hideReview: boolean,
): Map<string, BillSuggestion[]> {
  const filtered = hideReview
    ? items.filter((s) => s.status !== "review")
    : items
  const map = new Map<string, BillSuggestion[]>()
  for (const item of filtered) {
    const payee = suggestionPayee(item)
    const list = map.get(payee) ?? []
    list.push(item)
    map.set(payee, list)
  }
  return map
}

export function orderedPayeeKeys(
  grouped: Map<string, BillSuggestion[]>,
): string[] {
  return [...grouped.keys()].sort((a, b) => a.localeCompare(b))
}

/** @deprecated Use groupByPayee — bucket field now holds payee for grouping. */
export const groupByBucket = groupByPayee

/** @deprecated Use orderedPayeeKeys */
export const orderedBucketKeys = orderedPayeeKeys
