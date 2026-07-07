import { Button } from "@/components/ui/button"
import type { SpendingBarViewMode } from "@/lib/spendingBarView"

type SpendingBarViewControlsProps = {
  viewMode: SpendingBarViewMode
  onViewModeChange: (mode: SpendingBarViewMode) => void
  disabled?: boolean
}

export function SpendingBarViewControls({
  viewMode,
  onViewModeChange,
  disabled = false,
}: SpendingBarViewControlsProps) {
  return (
    <div
      className={`inline-flex rounded-md border shadow-xs ${disabled ? "opacity-50" : ""}`}
      role="group"
      aria-label="Spending chart view"
    >
      <Button
        type="button"
        variant={viewMode === "combined" ? "default" : "outline"}
        size="sm"
        className="rounded-r-none border-0"
        disabled={disabled}
        aria-pressed={viewMode === "combined"}
        onClick={() => onViewModeChange("combined")}
      >
        Combined
      </Button>
      <Button
        type="button"
        variant={viewMode === "split" ? "default" : "outline"}
        size="sm"
        className="rounded-l-none border-0 border-l"
        disabled={disabled}
        aria-pressed={viewMode === "split"}
        onClick={() => onViewModeChange("split")}
      >
        Cash & Credit
      </Button>
    </div>
  )
}
