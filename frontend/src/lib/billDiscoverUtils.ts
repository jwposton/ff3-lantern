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
