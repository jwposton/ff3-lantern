import {
  BarChart3,
  CreditCard,
  Info,
  Landmark,
  LayoutDashboard,
  Link as LinkIcon,
  LogOut,
  PiggyBank,
  Receipt,
  ScanSearch,
  ShieldAlert,
  Table,
  Tags,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { Link, NavLink, useLocation, useMatch } from "react-router-dom"

import { AppLogo } from "@/components/AppLogo"
import { AppVersionBadge } from "@/components/AppVersionBadge"
import { ReferenceCacheMenuItem } from "@/components/ReferenceCacheButton"
import { ComparisonGraphIcon } from "@/components/icons/ComparisonGraphIcon"
import { SankeyChartIcon } from "@/components/icons/SankeyChartIcon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAuth } from "@/context/AuthContext"
import { PRODUCT_NAME } from "@/lib/product"
import { formatDemoAnchorLabel } from "@/lib/appClock"
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

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
  resource?: string
}

const generalNavItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  {
    to: "/reports/transactions",
    label: "Transaction Explorer",
    icon: Table,
    end: false,
    resource: "transactions",
  },
]

const chartNavMeta: Record<
  ChartNavSuffix,
  { label: string; icon: LucideIcon }
> = {
  "": { label: "Bar", icon: BarChart3 },
  "/trends": { label: "Line/Trend", icon: TrendingUp },
  "/sankey": { label: "Sankey", icon: SankeyChartIcon },
  "/mom": { label: "Variance", icon: ComparisonGraphIcon },
}

const baseManageNavItems: NavItem[] = [
  {
    to: "/manage/categorize",
    label: "Categorize",
    icon: Tags,
    end: true,
    resource: "categorize",
  },
  {
    to: "/manage/loans/queue",
    label: "Loans",
    icon: Landmark,
    end: true,
    resource: "loans",
  },
]

const billPayNavItems: NavItem[] = [
  {
    to: "/manage/payment-run",
    label: "Worksheet",
    icon: Wallet,
    end: true,
    resource: "payment_worksheet",
  },
  {
    to: "/manage/bills",
    label: "Bills",
    icon: Receipt,
    end: false,
    resource: "bills",
  },
  {
    to: "/manage/payment-run/discover",
    label: "Bill Discovery",
    icon: ScanSearch,
    end: true,
    resource: "bill_discover",
  },
  {
    to: "/manage/payment-run/cards",
    label: "Credit cards",
    icon: CreditCard,
    end: false,
    resource: "payment_setup",
  },
  {
    to: "/manage/liabilities",
    label: "Liabilities",
    icon: Landmark,
    end: false,
    resource: "liabilities",
  },
  {
    to: "/manage/payment-run/buckets",
    label: "Cash accounts",
    icon: PiggyBank,
    end: true,
    resource: "payment_setup",
  },
  {
    to: "/manage/payment-run/external-links",
    label: "External links",
    icon: LinkIcon,
    end: true,
    resource: "payment_setup",
  },
]

const BILL_PAY_RESOURCES = [
  "payment_worksheet",
  "bills",
  "bill_discover",
  "payment_setup",
  "liabilities",
] as const

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count)
}

function filterNavItems(
  items: readonly NavItem[],
  canSee: (resource: string) => boolean,
): NavItem[] {
  return items.filter((item) => !item.resource || canSee(item.resource))
}

function NavItems({ items }: { items: readonly NavItem[] }) {
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

function ChartsNavGroup({ canSee }: { canSee: (resource: string) => boolean }) {
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

  if (!canSee("reports")) {
    return null
  }

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

function BillPayNavGroup({ items }: { items: readonly NavItem[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Bill Pay</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <NavItems items={items} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ManageNavItems({
  items,
  categorizeCount,
  loanSplitCount,
}: {
  items: readonly NavItem[]
  categorizeCount: number
  loanSplitCount: number
}) {
  const badgeCounts: Record<string, number> = {
    "/manage/categorize": categorizeCount,
    "/manage/loans/queue": loanSplitCount,
  }

  return (
    <>
      {items.map((item) => (
        <ManageNavItem
          key={item.to}
          {...item}
          badgeCount={badgeCounts[item.to] ?? 0}
        />
      ))}
    </>
  )
}

function InsecureBadge() {
  return (
    <>
      <div
        className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-950 dark:text-amber-100 group-data-[collapsible=icon]:hidden"
        role="status"
      >
        Auth disabled —{" "}
        <Link
          to="/about#authentication"
          className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-50"
        >
          Enable authentication
        </Link>
      </div>
      <div className="hidden border-b border-amber-500/30 bg-amber-500/10 px-2 py-2 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-md text-amber-950 dark:text-amber-100"
              aria-label="Auth disabled"
            >
              <ShieldAlert className="size-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            Auth disabled — see About to enable authentication
          </TooltipContent>
        </Tooltip>
      </div>
    </>
  )
}

function SidebarUserFooter() {
  const { user, logout } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  if (!user) {
    return null
  }

  const displayName = user.display_name?.trim() || user.username

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton className="pointer-events-none" tooltip={displayName}>
          <span className="truncate text-sm">{displayName}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          type="button"
          tooltip="Log out"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true)
            try {
              await logout()
            } finally {
              setSigningOut(false)
            }
          }}
        >
          <LogOut aria-hidden />
          <span>{signingOut ? "Signing out…" : "Log out"}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </>
  )
}

export function AppSidebar() {
  const { categorizeCount, loanSplitCount } = useManageQueueCounts()
  const { data: health } = useHealth()
  const { secured, authMode, hasPermission } = useAuth()
  const paymentWorksheetEnabled = health?.payment_worksheet_enabled ?? false
  const demoAnchorDate = health?.demo_anchor_date?.trim() || null

  const canSee = useCallback(
    (resource: string) => !secured || hasPermission(resource),
    [secured, hasPermission],
  )

  const visibleGeneralNav = useMemo(
    () => filterNavItems(generalNavItems, canSee),
    [canSee],
  )

  const visibleManageNav = useMemo(
    () => filterNavItems(baseManageNavItems, canSee),
    [canSee],
  )

  const visibleBillPayNav = useMemo(
    () => filterNavItems(billPayNavItems, canSee),
    [canSee],
  )

  const showBillPayGroup =
    paymentWorksheetEnabled &&
    (!secured ||
      BILL_PAY_RESOURCES.some((resource) => hasPermission(resource)))

  const showManageGroup = visibleManageNav.length > 0
  const showOpsCache = canSee("ops_cache")

  return (
    <Sidebar collapsible="icon">
      <SidebarRail />
      {demoAnchorDate ? (
        <div
          className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-950 dark:text-amber-100 group-data-[collapsible=icon]:hidden"
          role="status"
        >
          Demo — data as of {formatDemoAnchorLabel(demoAnchorDate)}
        </div>
      ) : null}
      {!secured ? <InsecureBadge /> : null}
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
              <NavItems items={visibleGeneralNav} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <ChartsNavGroup canSee={canSee} />
        {showManageGroup ? (
          <SidebarGroup>
            <SidebarGroupLabel>Manage</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <ManageNavItems
                  items={visibleManageNav}
                  categorizeCount={categorizeCount}
                  loanSplitCount={loanSplitCount}
                />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        {showBillPayGroup ? (
          <BillPayNavGroup items={visibleBillPayNav} />
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-center px-2 py-1 group-data-[collapsible=icon]:hidden">
          <AppVersionBadge className="text-[10px]" />
        </div>
        <SidebarMenu>
          {showOpsCache ? <ReferenceCacheMenuItem /> : null}
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
          {authMode !== "none" ? <SidebarUserFooter /> : null}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
