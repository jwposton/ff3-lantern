import type { BillSuggestion } from "@/lib/paymentRunApi"

// Keep in sync with backend/payment_worksheet_bill_suggestions.py BUCKET_ORDER
export const BUCKET_ORDER = [
  "Streaming & Media",
  "AI & Dev Tools",
  "Hosting & Domains",
  "Utilities & Telecom",
  "Utilities — Trash",
  "Insurance",
  "Housing — Rent",
  "Apple Services",
  "Tickets & Events",
  "Other Recurring",
] as const

// Keep in sync with backend/payment_worksheet_bill_suggestions.py OPAQUE_BUCKET_SLOT
export const OPAQUE_BUCKET_SLOT = BUCKET_ORDER.indexOf("Apple Services")

export const LOOKBACK_CHOICES = [6, 12, 24] as const

export function parseLookback(raw: string | null): number {
  const n = raw ? Number(raw) : 12
  return (LOOKBACK_CHOICES as readonly number[]).includes(n) ? n : 12
}

export function groupByBucket(
  items: BillSuggestion[],
  hideReview: boolean,
): Map<string, BillSuggestion[]> {
  const filtered = hideReview
    ? items.filter((s) => s.status !== "review")
    : items
  const map = new Map<string, BillSuggestion[]>()
  for (const item of filtered) {
    const list = map.get(item.bucket) ?? []
    list.push(item)
    map.set(item.bucket, list)
  }
  return map
}

export function orderedBucketKeys(
  grouped: Map<string, BillSuggestion[]>,
): string[] {
  const presentKeys = new Set(grouped.keys())
  const bucketOrderSet = new Set<string>(BUCKET_ORDER)
  const dynamicKeys = [...presentKeys]
    .filter((key) => !bucketOrderSet.has(key))
    .sort((a, b) => a.localeCompare(b))

  const result: string[] = []
  for (let i = 0; i < BUCKET_ORDER.length; i += 1) {
    if (i === OPAQUE_BUCKET_SLOT) {
      result.push(...dynamicKeys)
    }
    const key = BUCKET_ORDER[i]
    if (presentKeys.has(key)) {
      result.push(key)
    }
  }
  return result
}
