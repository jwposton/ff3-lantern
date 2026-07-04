import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { clearReferenceCache } from "@/lib/cacheApi"
import { invalidateReportCaches } from "@/lib/reportCache"

export function ReferenceCacheButton() {
  const queryClient = useQueryClient()
  const [clearing, setClearing] = useState(false)

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="px-2"
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
            <RefreshCw
              className={`size-4 ${clearing ? "animate-spin" : ""}`}
              aria-hidden
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Clear cached accounts, categories, and budgets from Firefly
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
