import { Card, CardContent } from "@/components/ui/card"
import { DashboardTileHeader } from "@/components/DashboardTileHeader"
import { Skeleton } from "@/components/ui/skeleton"
import {
  monthlyCashFlowTileSubtitle,
  monthlyCashFlowTileTitle,
} from "@/lib/dashboardTileLabels"
import type { MonthCashFlowKpi } from "@/lib/spending"
import { formatCurrency, formatSignedCurrency } from "@/lib/spending"

type CashFlowKpiCardProps = {
  title: string
  subtitle: string
  kpi: MonthCashFlowKpi
  loading: boolean
}

function MetricBlock({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string
  value: string
  hint?: string
  valueClassName?: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`text-2xl font-bold leading-tight tracking-tight sm:text-[28px] ${valueClassName ?? ""}`}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function CashFlowKpiCard({ title, subtitle, kpi, loading }: CashFlowKpiCardProps) {
  if (loading) {
    return (
      <Card className="md:col-span-2">
        <DashboardTileHeader title={title} subtitle={subtitle} />
        <CardContent>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const netClassName =
    kpi.netCashFlow >= 0
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-destructive"

  return (
    <Card className="md:col-span-2">
      <DashboardTileHeader title={title} subtitle={subtitle} />
      <CardContent>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <MetricBlock label="Income" value={formatCurrency(kpi.income)} />
          <MetricBlock
            label="Net cash flow"
            value={formatSignedCurrency(kpi.netCashFlow)}
            valueClassName={netClassName}
          />
          <MetricBlock
            label="Total spending"
            value={formatCurrency(kpi.spending)}
            hint="Incl. credit card"
          />
        </div>
      </CardContent>
    </Card>
  )
}

type MonthlyCashFlowKpiCardProps = {
  currentMonth: string
  kpi: MonthCashFlowKpi
  loading: boolean
}

/** Cash flow KPIs for the current calendar month. */
export function MonthlyCashFlowKpiCard({
  currentMonth,
  kpi,
  loading,
}: MonthlyCashFlowKpiCardProps) {
  return (
    <CashFlowKpiCard
      title={monthlyCashFlowTileTitle()}
      subtitle={monthlyCashFlowTileSubtitle(currentMonth)}
      kpi={kpi}
      loading={loading}
    />
  )
}
