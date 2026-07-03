export type ReportLens = "spending" | "cash-flow"

export type ChartNavSuffix = "" | "/trends" | "/sankey" | "/mom"

export const REPORT_LENS_ROOT: Record<ReportLens, string> = {
  spending: "/reports/spending",
  "cash-flow": "/reports/cash-flow",
}

export const CHART_NAV_ENTRIES: readonly {
  suffix: ChartNavSuffix
  end: boolean
}[] = [
  { suffix: "", end: true },
  { suffix: "/trends", end: false },
  { suffix: "/sankey", end: false },
  { suffix: "/mom", end: false },
]

export function detectReportLens(pathname: string): ReportLens {
  if (
    pathname === "/reports/cash-flow" ||
    pathname.startsWith("/reports/cash-flow/")
  ) {
    return "cash-flow"
  }
  return "spending"
}

export function buildChartNavPath(
  lens: ReportLens,
  suffix: ChartNavSuffix,
): string {
  return `${REPORT_LENS_ROOT[lens]}${suffix}`
}

/** Keep the current chart type when switching spending ↔ cash-flow lenses. */
export function swapReportLensPath(pathname: string, lens: ReportLens): string {
  const root = REPORT_LENS_ROOT[lens]
  if (
    pathname === "/reports/cash-flow" ||
    pathname.startsWith("/reports/cash-flow/")
  ) {
    return root + pathname.slice("/reports/cash-flow".length)
  }
  if (
    pathname === "/reports/spending" ||
    pathname.startsWith("/reports/spending/")
  ) {
    return root + pathname.slice("/reports/spending".length)
  }
  return root
}
