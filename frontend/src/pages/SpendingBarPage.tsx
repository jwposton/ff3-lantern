import { BudgetBarReportPage } from "@/components/BudgetBarReportPage"
import { isSpendingExpense } from "@/lib/spending"

export function SpendingBarPage() {
  return (
    <BudgetBarReportPage
      filter={isSpendingExpense}
      pageTitle="Spending"
      mainChartTitle="Spending by month"
      emptyMessage="No spending in this date range"
      yAxisName="Spending"
      enablePaymentRailSplit
    />
  )
}
