import type {
  CreditCardRow,
  PaymentWorksheetEnvelope,
  ResolvedExternalLink,
} from "./paymentRunApi"
import { deriveWorksheetBillRows } from "./worksheetBillGroups"

export const OPEN_ALL_WARN_THRESHOLD = 15

function defaultSortCompare(a: CreditCardRow, b: CreditCardRow): number {
  const ao = a.sort_order ?? 999_999
  const bo = b.sort_order ?? 999_999
  if (ao !== bo) return ao - bo
  const nameCmp = (a.name ?? "").localeCompare(b.name ?? "")
  if (nameCmp !== 0) return nameCmp
  return a.account_id.localeCompare(b.account_id)
}

function pushUrl(
  urls: string[],
  seen: Set<string>,
  link: ResolvedExternalLink | null | undefined,
): void {
  const url = link?.url
  if (!url || seen.has(url)) return
  seen.add(url)
  urls.push(url)
}

export function collectOpenAllPortalUrls(
  worksheet: PaymentWorksheetEnvelope,
): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  for (const bucket of worksheet.buckets) {
    pushUrl(urls, seen, bucket.external_link ?? undefined)
  }

  const cards = [...worksheet.credit_cards].sort(defaultSortCompare)
  for (const card of cards) {
    pushUrl(urls, seen, card.external_link ?? undefined)
  }

  const derived = deriveWorksheetBillRows(
    "bills",
    worksheet.bills,
    worksheet.bill_groups,
  )
  for (const item of derived) {
    if (item.kind === "individual") {
      pushUrl(urls, seen, item.row.external_link ?? undefined)
    } else if (item.kind === "group_parent") {
      for (const child of item.children) {
        pushUrl(urls, seen, child.external_link ?? undefined)
      }
    }
  }

  for (const row of worksheet.liabilities) {
    pushUrl(urls, seen, row.external_link ?? undefined)
  }

  return urls
}

export function openPortalUrls(urls: string[]): number {
  let opened = 0
  for (const url of urls) {
    const handle = window.open(url, "_blank", "noopener,noreferrer")
    if (handle) opened += 1
  }
  return opened
}
