import { useCallback, useState } from "react"
import { Outlet, useLocation } from "react-router-dom"

import { AppSidebar } from "@/components/AppSidebar"
import { GlobalDatePicker } from "@/components/GlobalDatePicker"
import { DateRangeProvider } from "@/context/DateRangeContext"
import { pathnameUsesGlobalDateRange } from "@/lib/globalDateRangeRoutes"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

const SIDEBAR_STORAGE_KEY = "ff3analytics-sidebar-open"

function readSidebarOpen(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (stored === null) return true
    return stored === "true"
  } catch {
    return true
  }
}

function AppShellInner() {
  const { pathname } = useLocation()
  const showGlobalDatePicker = pathnameUsesGlobalDateRange(pathname)
  const [open, setOpen] = useState(readSidebarOpen)

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next))
    } catch {
      /* ignore quota / private mode */
    }
  }, [])

  return (
    <SidebarProvider open={open} onOpenChange={handleOpenChange}>
      <AppSidebar />
      <SidebarInset className="max-h-svh min-h-svh overflow-hidden">
        <header className="z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger aria-label="Toggle sidebar" />
          {showGlobalDatePicker ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <GlobalDatePicker />
            </div>
          ) : null}
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function AppShell() {
  return (
    <DateRangeProvider>
      <AppShellInner />
    </DateRangeProvider>
  )
}
