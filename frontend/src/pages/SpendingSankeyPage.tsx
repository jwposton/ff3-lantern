import { useState } from "react"

import { SankeyReportPage } from "@/components/SankeyReportPage"
import { buildSpendingSankeyData } from "@/lib/sankey"
import { readSankeyTopN, writeSankeyTopN } from "@/lib/sankeyTopN"
import { isSpendingExpense } from "@/lib/spending"

export function SpendingSankeyPage() {
  const [topN, setTopN] = useState(readSankeyTopN)

  return (
    <SankeyReportPage
      filter={isSpendingExpense}
      pageTitle="Spending"
      mainChartTitle="Money flow"
      interactionHint="Click a node to drill down. Click a flow to open matching transactions in Firefly."
      emptyMessage="No spending in this date range"
      buildMain={(rows) =>
        buildSpendingSankeyData(rows, "source-budget-category", topN)
      }
      enableDrilldown
      drilldownResetKey={topN}
      controls={
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 font-medium">
            Categories shown:
            <input
              type="range"
              min={5}
              max={25}
              value={topN}
              onChange={(e) => {
                const n = Number(e.target.value)
                setTopN(n)
                writeSankeyTopN(n)
              }}
              className="accent-primary"
              style={{ width: 120 }}
            />
            <span className="w-9 text-right font-mono tabular-nums">{topN}</span>
          </label>
        </div>
      }
    />
  )
}
