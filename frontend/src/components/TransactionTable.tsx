import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency, isSpendingWithdrawal } from "@/lib/spending"
import type { SortDir, SortKey } from "@/lib/transactionTable"
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
}: TransactionTableProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {COLUMNS.map((col) => (
                <TableHead key={col.key}>{col.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 12 }).map((_, i) => (
              <TableRow key={i}>
                {COLUMNS.map((col) => (
                  <TableCell key={col.key}>
                    <Skeleton className="h-5 w-full max-w-[8rem]" />
                  </TableCell>
                ))}
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
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const amount = formatAmount(row)
            return (
              <TableRow key={`${row.date}-${row.amount}-${index}`}>
                <TableCell>{row.date}</TableCell>
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
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
