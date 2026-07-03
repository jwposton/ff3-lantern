import { ExternalLink } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { buildFireflyTransactionUrl } from "@/lib/fireflyLinks"
import { formatDisplayDate } from "@/lib/formatDisplay"
import { formatCurrency, isSpendingWithdrawal } from "@/lib/spending"
import { isRowEditable, rowKey, type SortDir, type SortKey } from "@/lib/transactionTable"
import type { OmniRow } from "@/types/NormalizedTransaction"

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "amount", label: "Amount" },
  { key: "type", label: "Type" },
  { key: "category", label: "Category" },
  { key: "budget", label: "Budget" },
  { key: "source_account", label: "Source account" },
  { key: "destination_account", label: "Destination account" },
]

type TransactionTableProps = {
  rows: OmniRow[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  isLoading: boolean
  showAllTypes: boolean
  fireflyBaseUrl?: string
  selectionEnabled?: boolean
  selectedKeys?: Set<string>
  onToggleRow?: (key: string, selected: boolean) => void
  onTogglePage?: (keys: string[], selected: boolean) => void
}

function ariaSortValue(
  columnKey: SortKey,
  sortKey: SortKey,
  sortDir: SortDir,
): "ascending" | "descending" | "none" {
  if (columnKey !== sortKey) return "none"
  return sortDir === "asc" ? "ascending" : "descending"
}

function formatAmount(row: OmniRow): { text: string; className: string } {
  const raw = row.amount != null ? parseFloat(row.amount) : 0
  const text = formatCurrency(Math.abs(raw))
  if (isSpendingWithdrawal(row)) {
    return { text: `−${text}`, className: "font-medium tabular-nums text-destructive" }
  }
  return { text, className: "font-medium tabular-nums" }
}

function cellValue(row: OmniRow, key: SortKey): string {
  const v = row[key]
  if (v == null || v === "") return "—"
  return String(v)
}

export function TransactionTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  isLoading,
  showAllTypes,
  fireflyBaseUrl,
  selectionEnabled = false,
  selectedKeys,
  onToggleRow,
  onTogglePage,
}: TransactionTableProps) {
  const showLinkColumn = Boolean(fireflyBaseUrl)
  const editablePageKeys = rows.filter(isRowEditable).map(rowKey)
  const allPageSelected =
    editablePageKeys.length > 0 &&
    editablePageKeys.every((key) => selectedKeys?.has(key))

  if (isLoading) {
    return (
      <div className="rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/50">
            <TableRow>
              {selectionEnabled ? <TableHead className="w-10" /> : null}
              {COLUMNS.map((col) => (
                <TableHead key={col.key}>{col.label}</TableHead>
              ))}
              {showLinkColumn ? (
                <TableHead className="w-10">
                  <span className="sr-only">Open in Firefly</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 12 }).map((_, i) => (
              <TableRow key={i}>
                {selectionEnabled ? (
                  <TableCell>
                    <Skeleton className="h-4 w-4" />
                  </TableCell>
                ) : null}
                {COLUMNS.map((col) => (
                  <TableCell key={col.key}>
                    <Skeleton className="h-5 w-full max-w-[8rem]" />
                  </TableCell>
                ))}
                {showLinkColumn ? (
                  <TableCell>
                    <Skeleton className="h-5 w-8" />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-muted/50">
          <TableRow>
            {selectionEnabled ? (
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label="Select all on page"
                  checked={allPageSelected}
                  disabled={editablePageKeys.length === 0}
                  onChange={(e) =>
                    onTogglePage?.(editablePageKeys, e.target.checked)
                  }
                  className="rounded border"
                />
              </TableHead>
            ) : null}
            {COLUMNS.map((col) => (
              <TableHead key={col.key} aria-sort={ariaSortValue(col.key, sortKey, sortDir)}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                  onClick={() => onSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key ? (
                    <span className="text-xs text-muted-foreground" aria-hidden>
                      {sortDir === "asc" ? "↑" : "↓"}
                    </span>
                  ) : null}
                </button>
              </TableHead>
            ))}
            {showLinkColumn ? (
              <TableHead className="w-10">
                <span className="sr-only">Open in Firefly</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const amount = formatAmount(row)
            const fireflyUrl = buildFireflyTransactionUrl(
              fireflyBaseUrl,
              row.journal_id,
            )
            const key = rowKey(row)
            const editable = isRowEditable(row)
            return (
              <TableRow key={`${key}-${index}`}>
                {selectionEnabled ? (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select transaction ${formatDisplayDate(row.date)}`}
                      checked={selectedKeys?.has(key) ?? false}
                      disabled={!editable}
                      onChange={(e) => onToggleRow?.(key, e.target.checked)}
                      className="rounded border disabled:opacity-40"
                    />
                  </TableCell>
                ) : null}
                <TableCell>{formatDisplayDate(row.date)}</TableCell>
                <TableCell className={amount.className}>{amount.text}</TableCell>
                <TableCell>
                  {showAllTypes && row.type ? (
                    <Badge variant="secondary">{row.type}</Badge>
                  ) : (
                    row.type ?? "—"
                  )}
                </TableCell>
                <TableCell>{cellValue(row, "category")}</TableCell>
                <TableCell>{cellValue(row, "budget")}</TableCell>
                <TableCell>{cellValue(row, "source_account")}</TableCell>
                <TableCell>{cellValue(row, "destination_account")}</TableCell>
                {showLinkColumn ? (
                  <TableCell className="text-right">
                    {fireflyUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        asChild
                      >
                        <a
                          href={fireflyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open transaction in Firefly"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
