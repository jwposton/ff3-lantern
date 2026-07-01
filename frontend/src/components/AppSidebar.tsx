import {
  BarChart3,
  Info,
  LayoutDashboard,
  Table,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import { NavLink } from "react-router-dom"

import { ComparisonGraphIcon } from "@/components/icons/ComparisonGraphIcon"
import { SankeyChartIcon } from "@/components/icons/SankeyChartIcon"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
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

const spendingNavItems = [
  {
    to: "/reports/spending",
    label: "Bar",
    icon: BarChart3,
    end: true,
  },
  {
    to: "/reports/spending/trends",
    label: "Line/Trend",
    icon: TrendingUp,
    end: false,
  },
  {
    to: "/reports/spending/sankey",
    label: "Sankey",
    icon: SankeyChartIcon,
    end: false,
  },
  {
    to: "/reports/spending/mom",
    label: "MoM",
    icon: ComparisonGraphIcon,
    end: false,
  },
] as const

const cashFlowNavItems = [
  {
    to: "/reports/cash-flow",
    label: "Bar",
    icon: BarChart3,
    end: true,
  },
  {
    to: "/reports/cash-flow/trends",
    label: "Line/Trend",
    icon: TrendingUp,
    end: false,
  },
  {
    to: "/reports/cash-flow/sankey",
    label: "Sankey",
    icon: SankeyChartIcon,
    end: false,
  },
  {
    to: "/reports/cash-flow/mom",
    label: "MoM",
    icon: ComparisonGraphIcon,
    end: false,
  },
] as const

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

export function AppSidebar() {
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
        <SidebarGroup>
          <SidebarGroupLabel>Spending</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItems items={spendingNavItems} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Cash Flow</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItems items={cashFlowNavItems} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
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
