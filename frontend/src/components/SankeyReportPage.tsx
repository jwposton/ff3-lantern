import { useCallback, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

import { SankeyChart } from "@/components/SankeyChart"
import { Button } from "@/components/ui/button"
import { useDateRange } from "@/context/DateRangeContext"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import {
  buildDateRangeFilters,
  buildFireflyFilters,
  getSpendingNodeQueryString,
  openFireflySearch,
} from "@/lib/fireflySearch"
import type { FlowType, SankeyData, SelectedSankeyNode } from "@/lib/sankey"
import {
  buildSpendingSankeyData,
  filterRowsForDrilldown,
  sankeyChartHeight,
} from "@/lib/sankey"
import type { OmniRow } from "@/types/NormalizedTransaction"

export type SankeyReportPageProps = {
  filter: (row: OmniRow) => boolean
  pageTitle: string
  mainChartTitle: string
  interactionHint: string
  emptyMessage: string
  buildMain: (rows: OmniRow[]) => SankeyData
  controls?: ReactNode
  enableDrilldown?: boolean
  drilldownResetKey?: number | string
}

function parseNodeSelection(
  nodeName: string,
  nodeDisplay: Record<string, string>,
): SelectedSankeyNode | null {
  const typeMatch = nodeName.match(/\((B|C|P|A|T)\)$/)
  if (!typeMatch) return null

  let type: SelectedSankeyNode["type"]
  switch (typeMatch[1]) {
    case "B":
      type = "Budget"
      break
    case "C":
      type = "Category"
      break
    case "P":
      type = "Payee"
      break
    case "A":
      type = "Account"
      break
    case "T":
      type = "AccountType"
      break
    default:
      return null
  }

  let displayName = nodeDisplay[nodeName] ?? nodeName
  if (type === "AccountType") {
    if (nodeName === "Bank Account (T)") displayName = "Bank Accounts"
    else if (nodeName === "Credit Card (T)") displayName = "Credit Cards"
  }

  return { name: nodeName, type, displayName }
}

function drilldownFlowType(
  selected: SelectedSankeyNode,
): FlowType {
  switch (selected.type) {
    case "Budget":
      return "source-budget-category-payee"
    case "Category":
      return "source-category-payee"
    case "Account":
    case "AccountType":
      return "source-budget-category"
    default:
      return "source-budget-category"
  }
}

export function SankeyReportPage({
  filter,
  pageTitle,
  mainChartTitle,
  interactionHint,
  emptyMessage,
  buildMain,
  controls,
  enableDrilldown = false,
  drilldownResetKey,
}: SankeyReportPageProps) {
  const { committedRange } = useDateRange()
  const { start: committedStart, end: committedEnd } = committedRange
  const { isPending, isError, isSuccess, data, refetch } =
    useNormalizedTransactions(committedStart, committedEnd)

  const [selectedNode, setSelectedNode] = useState<SelectedSankeyNode | null>(
    null,
  )

  useEffect(() => {
    setSelectedNode(null)
  }, [committedStart, committedEnd])

  useEffect(() => {
    if (drilldownResetKey !== undefined) {
      setSelectedNode(null)
    }
  }, [drilldownResetKey])

  const allRows = isSuccess ? (data?.data ?? []) : []

  const fireflyBaseUrl =
    (isSuccess ? data?.firefly_base_url : undefined) ??
    (import.meta.env.VITE_FIREFLY_BASE_URL as string | undefined) ??
    ""

  const dateFilters = useMemo(
    () => buildDateRangeFilters(committedStart, committedEnd),
    [committedStart, committedEnd],
  )

  const sliceRows = useMemo(() => allRows.filter(filter), [allRows, filter])

  const mainData = useMemo(
    () => buildMain(sliceRows),
    [sliceRows, buildMain],
  )

  const mainNodeDisplay = useMemo(() => {
    const map: Record<string, string> = {}
    mainData.nodes.forEach((n) => {
      map[n.name] = n.displayName
    })
    return map
  }, [mainData.nodes])

  const subchartData = useMemo(() => {
    if (!enableDrilldown || !selectedNode) {
      return { nodes: [], links: [] }
    }
    const filtered = filterRowsForDrilldown(sliceRows, selectedNode)
    return buildSpendingSankeyData(filtered, drilldownFlowType(selectedNode))
  }, [enableDrilldown, selectedNode, sliceRows])

  const subchartNodeDisplay = useMemo(() => {
    const map: Record<string, string> = {}
    subchartData.nodes.forEach((n) => {
      map[n.name] = n.displayName
    })
    return map
  }, [subchartData.nodes])

  const handleEdgeFirefly = useCallback(
    (source: string, target: string, nodeDisplay: Record<string, string>) => {
      if (!fireflyBaseUrl) return
      const filters = buildFireflyFilters(
        dateFilters,
        source,
        target,
        nodeDisplay,
      )
      openFireflySearch(fireflyBaseUrl, filters)
    },
    [fireflyBaseUrl, dateFilters],
  )

  const handleSubchartNodeFirefly = useCallback(
    (nodeName: string) => {
      if (!fireflyBaseUrl) return
      const displayName = subchartNodeDisplay[nodeName] ?? nodeName
      const nodeFilter = getSpendingNodeQueryString(nodeName, displayName)
      if (!nodeFilter) return
      const filters = [...dateFilters, nodeFilter].filter(Boolean).join(" ")
      openFireflySearch(fireflyBaseUrl, filters)
    },
    [fireflyBaseUrl, dateFilters, subchartNodeDisplay],
  )

  const handleMainNodeClick = (nodeName: string) => {
    if (!enableDrilldown) return
    const parsed = parseNodeSelection(nodeName, mainNodeDisplay)
    if (parsed) setSelectedNode(parsed)
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">{pageTitle}</h1>

      {controls}

      {isError ? (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
          role="alert"
        >
          <h2 className="text-sm font-semibold text-destructive">
            Unable to load transactions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Check that the backend is running and Firefly credentials are
            configured.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              void refetch()
            }}
          >
            Retry
          </Button>
        </div>
      ) : (
        <>
          <SankeyChart
            data={mainData}
            loading={isPending}
            emptyMessage={emptyMessage}
            height={sankeyChartHeight(mainData.nodes.length)}
            chartTitle={mainChartTitle}
            interactionHint={interactionHint}
            onNodeClick={enableDrilldown ? handleMainNodeClick : undefined}
            onEdgeClick={(source, target) =>
              handleEdgeFirefly(source, target, mainNodeDisplay)
            }
          />

          {enableDrilldown && selectedNode && (
            <SankeyChart
              data={subchartData}
              emptyMessage="No breakdown data for this selection in this date range"
              height={sankeyChartHeight(subchartData.nodes.length)}
              chartTitle={`${selectedNode.displayName} breakdown`}
              headerActions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedNode(null)}
                  aria-label="Clear sankey drilldown"
                >
                  Clear
                </Button>
              }
              onNodeClick={handleSubchartNodeFirefly}
              onEdgeClick={(source, target) =>
                handleEdgeFirefly(source, target, subchartNodeDisplay)
              }
            />
          )}
        </>
      )}
    </div>
  )
}
