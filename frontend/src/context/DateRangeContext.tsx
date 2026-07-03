import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useSearchParams } from "react-router-dom"

import {
  isValidRange,
  resolveInitialRange,
  STORAGE_KEY,
} from "@/lib/dateRange"

export type DateRangeValue = { start: string; end: string }

type DateRangeContextValue = {
  committedRange: DateRangeValue
  draftRange: DateRangeValue
  setDraftRange: (start: string, end: string) => void
  applyRange: (start: string, end: string) => void
}

const DateRangeContext = createContext<DateRangeContextValue | null>(null)

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function hasUrlRange(searchParams: URLSearchParams): boolean {
  const start = searchParams.get("start")
  const end = searchParams.get("end")
  return start != null && end != null && isValidRange(start, end)
}

function toRangeValue([start, end]: [string, string]): DateRangeValue {
  return { start, end }
}

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialized = useRef(false)
  const [committedRange, setCommittedRange] = useState<DateRangeValue | null>(
    null,
  )
  const [draftRange, setDraftRangeState] = useState<DateRangeValue | null>(null)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const [start, end] = resolveInitialRange(searchParams, readStorage())
    const range = toRangeValue([start, end])
    setCommittedRange(range)
    setDraftRangeState(range)

    if (!hasUrlRange(searchParams)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set("start", start)
          next.set("end", end)
          return next
        },
        { replace: true },
      )
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ start, end }))
      } catch {
        /* ignore */
      }
    }
  }, [searchParams, setSearchParams])

  const setDraftRange = useCallback((start: string, end: string) => {
    setDraftRangeState({ start, end })
  }, [])

  const applyRange = useCallback(
    (start: string, end: string) => {
      if (!isValidRange(start, end)) return
      const range = { start, end }
      setCommittedRange(range)
      setDraftRangeState(range)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set("start", start)
          next.set("end", end)
          return next
        },
        { replace: true },
      )
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ start, end }))
      } catch {
        /* ignore */
      }
    },
    [setSearchParams],
  )

  const value = useMemo<DateRangeContextValue | null>(() => {
    if (committedRange == null || draftRange == null) return null
    return {
      committedRange,
      draftRange,
      setDraftRange,
      applyRange,
    }
  }, [committedRange, draftRange, setDraftRange, applyRange])

  if (value == null) return null

  return (
    <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>
  )
}

export function useDateRange(): DateRangeContextValue {
  const ctx = useContext(DateRangeContext)
  if (ctx == null) {
    throw new Error("useDateRange must be used within DateRangeProvider")
  }
  return ctx
}
