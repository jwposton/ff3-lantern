import { MomVarianceReportPage } from "@/components/MomVarianceReportPage"
import { isCashFlowOutflow } from "@/lib/spending"

export function CashFlowMomPage() {
  return (
    <MomVarianceReportPage
      filter={isCashFlowOutflow}
      useCashFlowLabels
      pageTitle="Cash Flow"
      emptyMessage="No cash outflow in this date range"
      compareEmptyMessage="Select a range spanning at least two months to compare months"
      compareAverageEmptyMessage="Not enough history for a rolling average comparison"
      momTopNFamily="cash-flow"
      trendChartTitle="MoM cash outflow change"
      compareChartTitle="Month-over-month cash outflow change"
      compareAverageChartTitle="Current month vs rolling average cash outflow"
      yAxisNameTrend="Δ cash outflow"
      yAxisNameCompare="Δ cash outflow"
      interactionHintTrend="Click a budget line to drill down by category."
      interactionHintCompare="Click a bar to drill down by category."
      tabTrendLabel="Trend"
      tabCompareLabel="Compare"
      topNLabel="Budgets shown:"
    />
  )
}
