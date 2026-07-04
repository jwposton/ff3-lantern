import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { MomVarianceTableData } from "@/lib/momVarianceTable"
import {
  deltaHeatmapCellStyle,
  deltaHeatmapTextClass,
  isDeltaHeatmapTable,
  maxAbsDeltaInTable,
} from "@/lib/deltaHeatmap"
import { formatCurrency } from "@/lib/spending"

/** Opaque equivalents of TableRow's muted/30 and hover muted/50 stripes (sticky cells cannot use alpha). */
const VARIANCE_ROW_STRIPE =
  "odd:!bg-background even:!bg-[color-mix(in_oklch,var(--muted)_30%,var(--background)_70%)] hover:!bg-[color-mix(in_oklch,var(--muted)_50%,var(--background)_50%)]"

const VARIANCE_STICKY_CELL_STRIPE =
  "group-odd:bg-background group-even:bg-[color-mix(in_oklch,var(--muted)_30%,var(--background)_70%)] group-hover:bg-[color-mix(in_oklch,var(--muted)_50%,var(--background)_50%)]"

const VARIANCE_STICKY_SHADOW =
  "shadow-[4px_0_6px_-4px_rgba(0,0,0,0.12)]"

function formatSignedCurrency(value: number): string {
  const prefix = value >= 0 ? "+" : ""
  return `${prefix}${formatCurrency(value)}`
}

function formatCellValue(value: number, kind: "amount" | "delta"): string {
  return kind === "delta" ? formatSignedCurrency(value) : formatCurrency(value)
}

type MomVarianceDataTableProps = {
  tableData: MomVarianceTableData | null
  loading?: boolean
  emptyMessage?: string
  title?: string
  embedded?: boolean
  onRowSelect?: (name: string) => void
}

export function MomVarianceDataTable({
  tableData,
  loading = false,
  emptyMessage = "No data for this view",
  title = "Monthly detail",
  embedded = false,
  onRowSelect,
}: MomVarianceDataTableProps) {
  if (loading) {
    if (embedded) {
      return <Skeleton className="h-40 w-full" data-testid="mom-variance-table-loading" />
    }
    return (
      <Card data-testid="mom-variance-table-loading">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    )
  }

  const isEmpty = tableData == null || tableData.rows.length === 0
  const useDeltaHeatmap =
    tableData != null && !isEmpty && isDeltaHeatmapTable(tableData)
  const heatmapMaxAbs = useDeltaHeatmap ? maxAbsDeltaInTable(tableData) : 0

  const tableBody = isEmpty ? (
    <div
      className="flex items-center justify-center py-8 text-center text-sm text-muted-foreground"
      data-testid="mom-variance-table-empty"
    >
      {emptyMessage}
    </div>
  ) : (
    <Table data-testid={embedded ? "mom-variance-table-embedded" : "mom-variance-table"}>
      <TableHeader>
        <TableRow>
          <TableHead
            className={`sticky left-0 z-20 bg-[color-mix(in_oklch,var(--muted)_50%,var(--background)_50%)] ${VARIANCE_STICKY_SHADOW}`}
          >
            {tableData.rowLabel}
          </TableHead>
          {tableData.columns.map((column) => (
            <TableHead key={column.key} className="text-right">
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tableData.rows.map((row) => (
          <TableRow
            key={row.name}
            className={[
              "group",
              VARIANCE_ROW_STRIPE,
              onRowSelect ? "cursor-pointer" : undefined,
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={onRowSelect ? () => onRowSelect(row.name) : undefined}
          >
            <TableCell
              className={`sticky left-0 z-20 font-medium ${VARIANCE_STICKY_SHADOW} ${VARIANCE_STICKY_CELL_STRIPE}`}
            >
              {row.name}
            </TableCell>
            {tableData.columns.map((column) => {
              const value = row.values[column.key] ?? 0
              const heatmapStyle =
                useDeltaHeatmap && column.kind === "delta"
                  ? deltaHeatmapCellStyle(value, heatmapMaxAbs)
                  : undefined
              const heatmapTextClass =
                useDeltaHeatmap && column.kind === "delta"
                  ? deltaHeatmapTextClass(value)
                  : undefined

              return (
                <TableCell
                  key={column.key}
                  className={[
                    "text-right font-mono tabular-nums",
                    heatmapTextClass,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={heatmapStyle}
                >
                  {formatCellValue(value, column.kind)}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  if (embedded) {
    return tableBody
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{tableBody}</CardContent>
    </Card>
  )
}
