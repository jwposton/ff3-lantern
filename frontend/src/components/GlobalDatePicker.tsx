import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDateRange } from "@/context/DateRangeContext"
import {
  isValidRange,
  monthToDate,
  previousMonthToDate,
  validateDateString,
  yearToDate,
} from "@/lib/dateRange"

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
  const today = todayString()

  const applyDisabled = useMemo(() => {
    if (!isValidRange(draftRange.start, draftRange.end)) return true
    return (
      draftRange.start === committedRange.start &&
      draftRange.end === committedRange.end
    )
  }, [draftRange, committedRange])

  return (
    <div className="flex flex-wrap items-center gap-2">
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
    </div>
  )
}
