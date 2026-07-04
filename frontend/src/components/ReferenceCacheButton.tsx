import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { clearReferenceCache } from "@/lib/cacheApi"
import { invalidateReportCaches } from "@/lib/reportCache"

export function ReferenceCacheMenuItem() {
  const queryClient = useQueryClient()
  const [clearing, setClearing] = useState(false)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        tooltip="Clear cached accounts, categories, and budgets from Firefly"
        disabled={clearing}
        aria-label="Clear reference cache"
        onClick={async () => {
          setClearing(true)
          try {
            await clearReferenceCache()
            await invalidateReportCaches(queryClient)
          } finally {
            setClearing(false)
          }
        }}
      >
        <RefreshCw className={clearing ? "animate-spin" : ""} aria-hidden />
        <span>Clear cache</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
