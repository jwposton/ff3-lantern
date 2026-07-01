import { Button } from "@/components/ui/button"
import { TOP_N_MAX, TOP_N_MIN } from "@/lib/topNConstants"
import type { TrendChartType } from "@/lib/trendsChartType"
import type { TrendViewMode } from "@/lib/trendsViewMode"

type TrendsControlsProps = {
  viewMode: TrendViewMode
  chartType: TrendChartType
  topN: number
  onViewModeChange: (mode: TrendViewMode) => void
  onChartTypeChange: (type: TrendChartType) => void
  onTopNChange: (n: number) => void
  disabled?: boolean
}

export function TrendsControls({
  viewMode,
  chartType,
  topN,
  onViewModeChange,
  onChartTypeChange,
  onTopNChange,
  disabled = false,
}: TrendsControlsProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-4 ${disabled ? "opacity-50" : ""}`}
    >
      <div
        className="inline-flex rounded-md border shadow-xs"
        role="group"
        aria-label="Chart view mode"
      >
        <Button
          type="button"
          variant={viewMode === "total" ? "default" : "outline"}
          size="sm"
          className="rounded-r-none border-0"
          disabled={disabled}
          onClick={() => onViewModeChange("total")}
        >
          Total
        </Button>
        <Button
          type="button"
          variant={viewMode === "category" ? "default" : "outline"}
          size="sm"
          className="rounded-l-none border-0 border-l"
          disabled={disabled}
          onClick={() => onViewModeChange("category")}
        >
          By category
        </Button>
      </div>

      <div
        className="inline-flex rounded-md border shadow-xs"
        role="group"
        aria-label="Chart type"
      >
        <Button
          type="button"
          variant={chartType === "line" ? "default" : "outline"}
          size="sm"
          className="rounded-r-none border-0"
          disabled={disabled}
          onClick={() => onChartTypeChange("line")}
        >
          Line
        </Button>
        <Button
          type="button"
          variant={chartType === "stacked-bar" ? "default" : "outline"}
          size="sm"
          className="rounded-l-none border-0 border-l"
          disabled={disabled}
          onClick={() => onChartTypeChange("stacked-bar")}
        >
          Stacked bar
        </Button>
      </div>

      {viewMode === "category" ? (
        <label className="flex min-w-[12rem] flex-1 items-center gap-3 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">Top categories: {topN}</span>
          <input
            type="range"
            min={TOP_N_MIN}
            max={TOP_N_MAX}
            value={topN}
            disabled={disabled}
            aria-label="Number of top categories to show"
            className="h-2 w-full min-w-[8rem] cursor-pointer accent-primary disabled:cursor-not-allowed"
            onChange={(e) => onTopNChange(Number(e.target.value))}
          />
        </label>
      ) : null}
    </div>
  )
}
