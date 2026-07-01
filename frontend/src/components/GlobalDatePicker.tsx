import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useDateRange } from "@/context/DateRangeContext"
import { clearReferenceCache } from "@/lib/cacheApi"
import {
  isValidRange,
  monthToDate,
  previousMonthToDate,
  validateDateString,
  yearToDate,
} from "@/lib/dateRange"
import { invalidateReportCaches } from "@/lib/reportCache"

const PRESETS = [
  { label: "MTD", getRange: monthToDate },
  { label: "Prev MTD", getRange: previousMonthToDate },
  { label: "YTD", getRange: yearToDate },
] as const

function todayString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function GlobalDatePicker() {
  const { draftRange, committedRange, setDraftRange, applyRange } = useDateRange()
  const queryClient = useQueryClient()
  const [clearing, setClearing] = useState(false)
  const today = todayString()

  const applyDisabled = useMemo(() => {
    if (!isValidRange(draftRange.start, draftRange.end)) return true
    return (
      draftRange.start === committedRange.start &&
      draftRange.end === committedRange.end
    )
  }, [draftRange, committedRange])

  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(({ label, getRange }) => (
          <Button
            key={label}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const [start, end] = getRange()
              setDraftRange(start, end)
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          className="h-8 w-[140px]"
          value={draftRange.start}
          max={draftRange.end}
          onChange={(e) => setDraftRange(e.target.value, draftRange.end)}
          onBlur={(e) => {
            if (!validateDateString(e.target.value)) return
            setDraftRange(e.target.value, draftRange.end)
          }}
          aria-label="Start date"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          className="h-8 w-[140px]"
          value={draftRange.end}
          min={draftRange.start}
          max={today}
          onChange={(e) => setDraftRange(draftRange.start, e.target.value)}
          onBlur={(e) => {
            if (!validateDateString(e.target.value)) return
            setDraftRange(draftRange.start, e.target.value)
          }}
          aria-label="End date"
        />
      </div>
      <Button
        type="button"
        size="sm"
        disabled={applyDisabled}
        onClick={() => applyRange(draftRange.start, draftRange.end)}
      >
        Apply
      </Button>
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
    </div>
  )
}
