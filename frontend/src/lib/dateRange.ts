export const STORAGE_KEY = "ff3analytics-date-range"

export type DateRange = [start: string, end: string]

type SearchParamsLike = URLSearchParams | { get: (key: string) => string | null }

import { referenceDate } from "@/lib/appClock"

function formatDateLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function monthToDate(now: Date = referenceDate()): DateRange {
  const end = formatDateLocal(now)
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
  return [formatDateLocal(startDate), end]
}

export function yearToDate(now: Date = referenceDate()): DateRange {
  const end = formatDateLocal(now)
  const startDate = new Date(now.getFullYear(), 0, 1)
  return [formatDateLocal(startDate), end]
}

export function previousMonthToDate(now: Date = referenceDate()): DateRange {
  const end = formatDateLocal(now)
  const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return [formatDateLocal(startDate), end]
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function validateDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const [yearStr, monthStr, dayStr] = value.split("-")
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const parsed = new Date(year, month - 1, day)
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  )
}

export function isValidRange(start: string, end: string): boolean {
  return validateDateString(start) && validateDateString(end) && start <= end
}

export function parseStoredRange(storageValue: string | null): DateRange | null {
  if (storageValue == null || storageValue === "") return null
  try {
    const parsed = JSON.parse(storageValue) as { start?: unknown; end?: unknown }
    if (typeof parsed.start !== "string" || typeof parsed.end !== "string") {
      return null
    }
    if (!isValidRange(parsed.start, parsed.end)) return null
    return [parsed.start, parsed.end]
  } catch {
    return null
  }
}

function readUrlRange(searchParams: SearchParamsLike): DateRange | null {
  const start = searchParams.get("start")
  const end = searchParams.get("end")
  if (start == null || end == null) return null
  if (!isValidRange(start, end)) return null
  return [start, end]
}

export function resolveInitialRange(
  searchParams: SearchParamsLike,
  storageValue: string | null,
  now: Date = new Date(),
): DateRange {
  const fromUrl = readUrlRange(searchParams)
  if (fromUrl) return fromUrl

  const fromStorage = parseStoredRange(storageValue)
  if (fromStorage) return fromStorage

  return monthToDate(now)
}
