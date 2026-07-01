import { lastDayOfMonth } from "@/lib/momVariance"

/** Shared dashboard tile header styling (KPI cards and chart cards). */
export const DASHBOARD_TILE_TITLE_CLASS =
  "text-base font-semibold tracking-tight"

export const DASHBOARD_TILE_SUBTITLE_CLASS =
  "text-sm font-normal text-muted-foreground"

const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

function monthLong(ym: string): string {
  const year = ym.slice(0, 4)
  const monthIndex = Number(ym.slice(5, 7)) - 1
  return `${MONTH_LONG[monthIndex]} ${year}`
}

function shortDate(ymd: string, includeYear = false): string {
  const monthIndex = Number(ymd.slice(5, 7)) - 1
  const day = Number(ymd.slice(8, 10))
  const year = ymd.slice(0, 4)
  const base = `${MONTH_SHORT[monthIndex]} ${day}`
  return includeYear ? `${base}, ${year}` : base
}

/** Human-readable label for the global dashboard date filter. */
export function formatDashboardDateRange(start: string, end: string): string {
  if (start === end) {
    return shortDate(start, true)
  }

  const startMonth = start.slice(0, 7)
  const endMonth = end.slice(0, 7)
  if (
    startMonth === endMonth &&
    start.endsWith("-01") &&
    end === lastDayOfMonth(endMonth)
  ) {
    return monthLong(startMonth)
  }

  if (startMonth === endMonth) {
    return `${shortDate(start)} – ${shortDate(end)}, ${start.slice(0, 4)}`
  }

  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  if (sameYear) {
    return `${shortDate(start)} – ${shortDate(end)}, ${start.slice(0, 4)}`
  }

  return `${shortDate(start, true)} – ${shortDate(end, true)}`
}

export function formatCalendarMonthLabel(month: string): string {
  return monthLong(month)
}

export function monthlyCashFlowTileTitle(): string {
  return "Monthly cash flow"
}

export function monthlyCashFlowTileSubtitle(currentMonth: string): string {
  return formatCalendarMonthLabel(currentMonth)
}

export function spendingByBudgetTileTitle(): string {
  return "Spending by budget"
}

export function cashFlowByBudgetTileTitle(): string {
  return "Cash flow by budget"
}

export function budgetVsAverageTileTitle(): string {
  return "Budget vs 12-month average"
}
