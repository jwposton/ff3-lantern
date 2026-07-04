import {
  BarChart3,
  Info,
  Landmark,
  LayoutDashboard,
  Table,
  Tags,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { useMemo } from "react"
import { NavLink, useLocation, useMatch, useNavigate } from "react-router-dom"

import { AppVersionBadge } from "@/components/AppVersionBadge"
import { ComparisonGraphIcon } from "@/components/icons/ComparisonGraphIcon"
import { SankeyChartIcon } from "@/components/icons/SankeyChartIcon"
import { Button } from "@/components/ui/button"
import { useHealth } from "@/hooks/useHealth"
import { useManageQueueCounts } from "@/hooks/useManageQueueCounts"
import {
  CHART_NAV_ENTRIES,
  buildChartNavPath,
  detectReportLens,
  swapReportLensPath,
  type ChartNavSuffix,
  type ReportLens,
} from "@/lib/reportLens"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const generalNavItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  {
    to: "/reports/transactions",
    label: "Transaction Explorer",
    icon: Table,
    end: false,
  },
] as const

const chartNavMeta: Record<
  ChartNavSuffix,
  { label: string; icon: LucideIcon }
> = {
  "": { label: "Bar", icon: BarChart3 },
  "/trends": { label: "Line/Trend", icon: TrendingUp },
  "/sankey": { label: "Sankey", icon: SankeyChartIcon },
  "/mom": { label: "Variance", icon: ComparisonGraphIcon },
}

const baseManageNavItems = [
  {
    to: "/manage/categorize",
    label: "Categorize",
    icon: Tags,
    end: true,
  },
  {
    to: "/manage/loans/queue",
    label: "Loans",
    icon: Landmark,
    end: true,
  },
] as const

const paymentWorksheetNavItem = {
  to: "/manage/payment-run",
  label: "Payment Worksheet",
  icon: Wallet,
  end: true,
} as const

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count)
}

function NavItems({
  items,
}: {
  items: readonly {
    to: string
    label: string
    icon: LucideIcon
    end: boolean
  }[]
}) {
  return (
    <>
      {items.map(({ to, label, icon: Icon, end }) => (
        <SidebarMenuItem key={to}>
          <NavLink to={to} end={end} className="contents">
            {({ isActive }) => (
              <SidebarMenuButton isActive={isActive} tooltip={label}>
                <Icon />
                <span>{label}</span>
              </SidebarMenuButton>
            )}
          </NavLink>
        </SidebarMenuItem>
      ))}
    </>
  )
}

function ReportLensToggle({
  lens,
  pathname,
}: {
  lens: ReportLens
  pathname: string
}) {
  const navigate = useNavigate()

  return (
    <div className="flex gap-1" role="group" aria-label="Report lens">
      {(["spending", "cash-flow"] as const).map((option) => (
        <Button
          key={option}
          type="button"
          size="xs"
          className="h-6 flex-1 px-1.5 text-[11px] font-medium"
          variant={lens === option ? "default" : "outline"}
          onClick={() => navigate(swapReportLensPath(pathname, option))}
        >
          {option === "spending" ? "Spending" : "Cash Flow"}
        </Button>
      ))}
    </div>
  )
}

function ChartsNavGroup() {
  const { pathname } = useLocation()
  const lens = detectReportLens(pathname)
  const chartNavItems = useMemo(
    () =>
      CHART_NAV_ENTRIES.map(({ suffix, end }) => {
        const meta = chartNavMeta[suffix]
        return {
          to: buildChartNavPath(lens, suffix),
          label: meta.label,
          icon: meta.icon,
          end,
        }
      }),
    [lens],
  )

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="h-auto flex-col items-stretch gap-1.5 py-1.5 group-data-[collapsible=icon]:hidden">
        <span>Charts</span>
        <ReportLensToggle lens={lens} pathname={pathname} />
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <NavItems items={chartNavItems} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ManageNavItem({
  to,
  label,
  icon: Icon,
  end,
  badgeCount,
}: {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
  badgeCount: number
}) {
  const isActive = Boolean(useMatch({ path: to, end }))

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <NavLink to={to} end={end}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      </SidebarMenuButton>
      {badgeCount > 0 ? (
        <SidebarMenuBadge>{formatBadgeCount(badgeCount)}</SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  )
}

function ManageNavItems({
  categorizeCount,
  loanSplitCount,
  paymentWorksheetEnabled,
}: {
  categorizeCount: number
  loanSplitCount: number
  paymentWorksheetEnabled: boolean
}) {
  const manageNavItems = paymentWorksheetEnabled
    ? [...baseManageNavItems, paymentWorksheetNavItem]
    : baseManageNavItems

  const badgeCounts: Record<string, number> = {
    "/manage/categorize": categorizeCount,
    "/manage/loans/queue": loanSplitCount,
  }

  return (
    <>
      {manageNavItems.map((item) => (
        <ManageNavItem
          key={item.to}
          {...item}
          badgeCount={badgeCounts[item.to] ?? 0}
        />
      ))}
    </>
  )
}

export function AppSidebar() {
  const { categorizeCount, loanSplitCount } = useManageQueueCounts()
  const { data: health } = useHealth()
  const paymentWorksheetEnabled = health?.payment_worksheet_enabled ?? false

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex h-12 items-center px-2 font-semibold tracking-tight group-data-[collapsible=icon]:justify-center">
          <span className="truncate group-data-[collapsible=icon]:hidden">
            FF3Analytics
          </span>
          <span className="hidden text-xs font-semibold group-data-[collapsible=icon]:inline">
            FF3
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItems items={generalNavItems} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <ChartsNavGroup />
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <ManageNavItems
                categorizeCount={categorizeCount}
                loanSplitCount={loanSplitCount}
                paymentWorksheetEnabled={paymentWorksheetEnabled}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-center px-2 py-1 group-data-[collapsible=icon]:hidden">
          <AppVersionBadge className="text-[10px]" />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <NavLink to="/about" className="contents">
              {({ isActive }) => (
                <SidebarMenuButton isActive={isActive} tooltip="About">
                  <Info />
                  <span>About</span>
                </SidebarMenuButton>
              )}
            </NavLink>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
