import { CardHeader, CardTitle } from "@/components/ui/card"
import {
  DASHBOARD_TILE_SUBTITLE_CLASS,
  DASHBOARD_TILE_TITLE_CLASS,
} from "@/lib/dashboardTileLabels"

type DashboardTileHeaderProps = {
  title: string
  subtitle?: string
}

export function DashboardTileHeader({ title, subtitle }: DashboardTileHeaderProps) {
  return (
    <CardHeader className="space-y-1 pb-2">
      <CardTitle className={DASHBOARD_TILE_TITLE_CLASS}>{title}</CardTitle>
      {subtitle ? (
        <p className={DASHBOARD_TILE_SUBTITLE_CLASS}>{subtitle}</p>
      ) : null}
    </CardHeader>
  )
}
