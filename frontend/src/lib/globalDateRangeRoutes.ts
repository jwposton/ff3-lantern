/** Routes where the shell header date picker drives page data via `useDateRange()`. */
export function pathnameUsesGlobalDateRange(pathname: string): boolean {
  if (pathname === "/") return true
  if (pathname === "/reports/transactions") return true
  if (pathname === "/manage/categorize") return true
  if (pathname === "/manage/loans/queue") return true

  if (pathname === "/manage/bills" || pathname.startsWith("/manage/bills/")) {
    return false
  }

  if (
    pathname.startsWith("/manage/loans/") &&
    pathname !== "/manage/loans/queue"
  ) {
    return true
  }

  if (
    pathname === "/reports/spending/mom" ||
    pathname === "/reports/cash-flow/mom"
  ) {
    return false
  }

  if (
    pathname === "/reports/spending" ||
    pathname.startsWith("/reports/spending/")
  ) {
    return true
  }

  if (
    pathname === "/reports/cash-flow" ||
    pathname.startsWith("/reports/cash-flow/")
  ) {
    return true
  }

  return false
}
