import {
  BarChart3,
  GitBranch,
  LayoutDashboard,
  Table,
  TrendingUp,
} from "lucide-react"
import { NavLink } from "react-router-dom"

import {
  Sidebar,
  SidebarContent,
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
    icon: GitBranch,
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
] as const

function NavItems({
  items,
}: {
  items: readonly {
    to: string
    label: string
    icon: typeof LayoutDashboard
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
    </Sidebar>
  )
}
