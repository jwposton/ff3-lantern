import { useMemo, useState } from "react"

import { SankeyReportPage } from "@/components/SankeyReportPage"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import {
  buildCashFlowSankeyData,
  isCashMovementRow,
  MAX_VISIBLE_BANKS,
  shouldBucketBanks,
} from "@/lib/sankey"
import {
  readAggregateBanks,
  writeAggregateBanks,
} from "@/lib/sankeyAggregateBanks"

export function CashFlowSankeyPage() {
  const [aggregateBanks, setAggregateBanks] = useState(readAggregateBanks)
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const { isSuccess, data } = useNormalizedTransactions(
    committedStart,
    committedEnd,
  )

  const sliceRows = useMemo(() => {
    const allRows = isSuccess ? (data?.data ?? []) : []
    return allRows.filter(isCashMovementRow)
  }, [isSuccess, data])

  const showBucketHint = !aggregateBanks && shouldBucketBanks(sliceRows)

  return (
    <SankeyReportPage
      filter={isCashMovementRow}
      pageTitle="Cash Flow"
      mainChartTitle="Cash flow"
      interactionHint="Click a node to drill down; click a flow to open matching transactions in Firefly."
      emptyMessage="No cash movement in this date range"
      buildMain={(rows) => buildCashFlowSankeyData(rows, aggregateBanks)}
      enableDrilldown={true}
      drilldownMode="cashflow"
      aggregateBanks={aggregateBanks}
      controls={
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={aggregateBanks}
              aria-label="Aggregate bank accounts"
              onChange={(e) => {
                const next = e.target.checked
                setAggregateBanks(next)
                writeAggregateBanks(next)
              }}
              className="accent-primary"
            />
            Aggregate bank accounts
          </label>
          {showBucketHint && (
            <p className="text-muted-foreground">
              Showing top {MAX_VISIBLE_BANKS} bank accounts by flow; others
              grouped as Other Banks
            </p>
          )}
        </div>
      }
    />
  )
}
