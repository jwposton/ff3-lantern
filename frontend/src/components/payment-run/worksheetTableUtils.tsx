import type { ReactNode } from "react"

import type {
  CreditCardRow,
  FundingBucketRollup,
} from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

export const COMPACT_TABLE =
  "text-xs [&_th]:h-8 [&_th]:px-2 [&_th]:py-1 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-xs [&_td]:min-h-0"

export const ACTIONS_HEAD_CLASS = "w-12 text-center"
export const ACTIONS_CELL_CLASS = "w-12 text-center"

export const FIREFLY_NAME_LINK_CLASS =
  "text-primary truncate font-medium underline-offset-2 hover:underline"

type PmtSrcRow = {
  payment_rail?: string
  funding_bucket_key?: string | null
  credit_card_account_id?: string | null
}

export function bucketLabel(
  buckets: FundingBucketRollup[],
  bucketKey: string | null | undefined,
): string {
  if (!bucketKey) return "—"
  return buckets.find((bucket) => bucket.id === bucketKey)?.label ?? "—"
}

export function cardName(
  creditCards: CreditCardRow[],
  accountId: string | null | undefined,
): string | null {
  if (!accountId) return null
  const card = creditCards.find((row) => row.account_id === accountId)
  return card?.name ?? accountId
}

/** Payment source label for bank rail (bucket) or credit-card rail (card name). */
export function formatPmtSrc(
  row: PmtSrcRow,
  buckets: FundingBucketRollup[],
  creditCards: CreditCardRow[],
): string {
  if (row.payment_rail === "credit_card") {
    return cardName(creditCards, row.credit_card_account_id) ?? "Card"
  }
  return bucketLabel(buckets, row.funding_bucket_key)
}

/** Rail-only label for bills table (Card vs Bank). */
export function formatPmtSrcRail(row: PmtSrcRow): string {
  return row.payment_rail === "credit_card" ? "Card" : "Bank"
}

type WorksheetNameLinkProps = {
  href: string | null
  title?: string
  children: ReactNode
  className?: string
  muted?: boolean
  paid?: boolean
}

export function WorksheetNameLink({
  href,
  title,
  children,
  className,
  muted = false,
  paid = false,
}: WorksheetNameLinkProps) {
  if (!href) {
    return (
      <span
        className={cn(
          "truncate font-medium",
          muted && "text-muted-foreground",
          paid && "font-semibold",
          className,
        )}
      >
        {children}
      </span>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        FIREFLY_NAME_LINK_CLASS,
        muted && "text-muted-foreground",
        paid && "font-semibold",
        className,
      )}
      title={title ?? `${children} — open in Firefly`}
    >
      {children}
    </a>
  )
}

export type SortDirection = "asc" | "desc"

export function nextSortDirection(
  currentKey: string | null,
  nextKey: string,
  currentDir: SortDirection,
): SortDirection {
  if (currentKey === nextKey) {
    return currentDir === "asc" ? "desc" : "asc"
  }
  return "asc"
}

export function sortDirectionIndicator(
  activeKey: string | null,
  columnKey: string,
  direction: SortDirection,
): string {
  if (activeKey !== columnKey) return "↕"
  return direction === "asc" ? "↑" : "↓"
}
