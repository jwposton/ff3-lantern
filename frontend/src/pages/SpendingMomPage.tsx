import { MomVarianceReportPage } from "@/components/MomVarianceReportPage"
import { isSpendingExpense } from "@/lib/spending"

export function SpendingMomPage() {
  return (
    <MomVarianceReportPage
      filter={isSpendingExpense}
      pageTitle="Spending"
      emptyMessage="No spending in this date range"
      compareEmptyMessage="Select a range spanning at least two months to compare months"
      compareAverageEmptyMessage="Not enough history for a rolling average comparison"
      momTopNFamily="spending"
      trendChartTitle="MoM spending change"
      compareChartTitle="Month-over-month spending change"
      compareAverageChartTitle="Current month vs rolling average spending"
      yAxisNameTrend="Δ spending"
      yAxisNameCompare="Δ spending"
      interactionHintTrend="Click a budget line to drill down by category."
      interactionHintCompare="Click a bar to drill down by category."
      tabTrendLabel="Trend"
      tabCompareLabel="Compare"
      topNLabel="Budgets shown:"
    />
  )
}
