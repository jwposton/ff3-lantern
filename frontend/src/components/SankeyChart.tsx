import { useCallback, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { SankeyData } from "@/lib/sankey"
import { formatCurrency } from "@/lib/spending"

type SankeyChartProps = {
  data: SankeyData
  loading?: boolean
  emptyMessage: string
  height?: number
  chartTitle?: string
  interactionHint?: string
  onNodeClick?: (nodeName: string) => void
  onEdgeClick?: (source: string, target: string) => void
}

export function SankeyChart({
  data,
  loading = false,
  emptyMessage,
  height = 540,
  chartTitle,
  interactionHint,
  onNodeClick,
  onEdgeClick,
}: SankeyChartProps) {
  const isEmpty = !loading && data.nodes.length === 0

  const nodeDisplay = useMemo(() => {
    const map: Record<string, string> = {}
    data.nodes.forEach((n) => {
      map[n.name] = n.displayName
    })
    return map
  }, [data.nodes])

  const { outflow, inflow } = useMemo(() => {
    const out: Record<string, number> = {}
    const inn: Record<string, number> = {}
    data.links.forEach((link) => {
      out[link.source] = (out[link.source] ?? 0) + link.value
      inn[link.target] = (inn[link.target] ?? 0) + link.value
    })
    return { outflow: out, inflow: inn }
  }, [data.links])

  const option = useMemo((): EChartsOption => {
    return {
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove",
        formatter: (params: unknown) => {
          if (!params || typeof params !== "object") return ""
          const item = params as {
            dataType?: string
            data?: {
              name?: string
              source?: string
              target?: string
              value?: number
            }
          }
          if (item.dataType === "node" && item.data?.name) {
            const name = item.data.name
            const disp = nodeDisplay[name] ?? name
            const out = outflow[name]
            const inn = inflow[name]
            const lines = [disp]
            if (inn !== undefined && inn > 0) {
              lines.push(`In: ${formatCurrency(inn)}`)
            }
            if (out !== undefined && out > 0) {
              lines.push(`Out: ${formatCurrency(out)}`)
            }
            return lines.join("\n")
          }
          if (item.dataType === "edge" && item.data) {
            const src =
              nodeDisplay[item.data.source ?? ""] ?? item.data.source ?? ""
            const tgt =
              nodeDisplay[item.data.target ?? ""] ?? item.data.target ?? ""
            const value = item.data.value ?? 0
            return `${src} → ${tgt}\n${formatCurrency(value)}`
          }
          return ""
        },
      },
      series: [
        {
          type: "sankey",
          data: data.nodes.map((n) => ({
            name: n.name,
            label: {
              show: true,
              formatter: n.displayName,
              fontWeight: "bold",
              fontSize: 12,
            },
          })),
          links: data.links,
          emphasis: {
            focus: "adjacency",
          },
        },
      ],
    }
  }, [data.nodes, data.links, nodeDisplay, outflow, inflow])

  const handleChartClick = useCallback(
    (params: {
      dataType?: string
      data?: { name?: string; source?: string; target?: string }
    }) => {
      if (!params?.data) return
      if (params.dataType === "edge" && onEdgeClick) {
        const source = params.data.source
        const target = params.data.target
        if (source && target) {
          onEdgeClick(source, target)
        }
        return
      }
      if (params.dataType === "node" && onNodeClick && params.data.name) {
        onNodeClick(params.data.name)
      }
    },
    [onEdgeClick, onNodeClick],
  )

  const onEvents = useMemo(
    () => ({
      click: handleChartClick,
    }),
    [handleChartClick],
  )

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[540px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      {(chartTitle || interactionHint) && (
        <CardHeader>
          {chartTitle && (
            <CardTitle className="text-base">{chartTitle}</CardTitle>
          )}
          {interactionHint && (
            <p className="text-sm text-muted-foreground">{interactionHint}</p>
          )}
        </CardHeader>
      )}
      <CardContent>
        {isEmpty ? (
          <div
            className="flex items-center justify-center text-center text-sm text-muted-foreground"
            style={{ minHeight: height }}
          >
            {emptyMessage}
          </div>
        ) : (
          <div data-testid="sankey-chart">
            <ReactECharts
              option={option}
              style={{ height, width: "100%" }}
              onEvents={onEvents}
              notMerge
              lazyUpdate
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
