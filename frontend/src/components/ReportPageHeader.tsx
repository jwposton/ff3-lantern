import { useLocation, useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { detectReportLens, swapReportLensPath } from "@/lib/reportLens"

export function ReportLensToggle() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const lens = detectReportLens(pathname)

  return (
    <div className="flex gap-1" role="group" aria-label="Report lens">
      {(["spending", "cash-flow"] as const).map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          className="h-8 px-3 text-sm font-medium"
          variant={lens === option ? "default" : "outline"}
          onClick={() => navigate(swapReportLensPath(pathname, option))}
        >
          {option === "spending" ? "Spending" : "Cash Flow"}
        </Button>
      ))}
    </div>
  )
}

export function ReportPageHeader({ title }: { title: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <ReportLensToggle />
    </div>
  )
}
