import {
  BarChart3,
  Info,
  Landmark,
  LayoutDashboard,
  Receipt,
  ScanSearch,
  Settings2,
  Table,
  Tags,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { useMemo } from "react"
import { NavLink, useLocation, useMatch } from "react-router-dom"

import { AppLogo } from "@/components/AppLogo"
import { AppVersionBadge } from "@/components/AppVersionBadge"
import { ReferenceCacheMenuItem } from "@/components/ReferenceCacheButton"
import { ComparisonGraphIcon } from "@/components/icons/ComparisonGraphIcon"
import { SankeyChartIcon } from "@/components/icons/SankeyChartIcon"
import { PRODUCT_NAME } from "@/lib/product"
import { useHealth } from "@/hooks/useHealth"
import { useManageQueueCounts } from "@/hooks/useManageQueueCounts"
import {
  CHART_NAV_ENTRIES,
  buildChartNavPath,
  detectReportLens,
  type ChartNavSuffix,
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
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

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

const paymentSetupNavItem = {
  to: "/manage/payment-run/setup",
  label: "Payment setup",
  icon: Settings2,
  end: true,
} as const

const billDiscoverNavItem = {
  to: "/manage/payment-run/discover",
  label: "Bill discover",
  icon: ScanSearch,
  end: true,
} as const

const billsNavItem = {
  to: "/manage/bills",
  label: "Bills",
  icon: Receipt,
  end: false,
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
      <SidebarGroupLabel>Charts</SidebarGroupLabel>
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

function SidebarLogoToggle() {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      type="button"
      data-sidebar="logo-toggle"
      aria-label="Toggle sidebar"
      onClick={toggleSidebar}
      className={cn(
        "shrink-0 rounded-md p-0.5 transition-colors",
        "cursor-pointer hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
      )}
    >
      <AppLogo
        decorative
        size={20}
        className="group-data-[collapsible=icon]:size-8"
      />
    </button>
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
    ? [
        ...baseManageNavItems,
        paymentWorksheetNavItem,
        paymentSetupNavItem,
        billDiscoverNavItem,
        billsNavItem,
      ]
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
      <SidebarRail />
      <SidebarHeader className="border-b border-sidebar-border group-data-[collapsible=icon]:px-0">
        <div className="flex h-12 w-full items-center gap-2 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0">
          <SidebarTrigger
            aria-label="Toggle sidebar"
            className="group-data-[collapsible=icon]:hidden"
          />
          <SidebarLogoToggle />
          <span className="truncate font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            {PRODUCT_NAME}
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
          <ReferenceCacheMenuItem />
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
