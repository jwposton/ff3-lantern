import { Button } from "@/components/ui/button"

type MassEditBarProps = {
  selectedCount: number
  matchingCount: number
  categories: Array<{ id: string; name: string }>
  budgets: Array<{ id: string; name: string }>
  categoryId: string
  budgetMode: "unchanged" | "set" | "clear"
  budgetId: string
  applying: boolean
  confirmOpen: boolean
  error: string | null
  onCategoryChange: (categoryId: string) => void
  onBudgetModeChange: (mode: "unchanged" | "set" | "clear") => void
  onBudgetChange: (budgetId: string) => void
  onSelectAllMatching: () => void
  onClearSelection: () => void
  onApplyClick: () => void
  onConfirmApply: () => void
  onCancelConfirm: () => void
}

export function MassEditBar({
  selectedCount,
  matchingCount,
  categories,
  budgets,
  categoryId,
  budgetMode,
  budgetId,
  applying,
  confirmOpen,
  error,
  onCategoryChange,
  onBudgetModeChange,
  onBudgetChange,
  onSelectAllMatching,
  onClearSelection,
  onApplyClick,
  onConfirmApply,
  onCancelConfirm,
}: MassEditBarProps) {
  const canApply =
    selectedCount > 0 &&
    (categoryId !== "" || budgetMode === "set" || budgetMode === "clear") &&
    (budgetMode !== "set" || budgetId !== "")

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {selectedCount} selected · {matchingCount} matching
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSelectAllMatching}
            disabled={matchingCount === 0}
          >
            Select all matching
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            disabled={selectedCount === 0}
          >
            Clear selection
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[12rem] flex-col gap-1 text-xs text-muted-foreground">
          Category
          <select
            aria-label="Mass edit category"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={categoryId}
            onChange={(e) => onCategoryChange(e.target.value)}
          >
            <option value="">Leave unchanged</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Budget
          <select
            aria-label="Mass edit budget mode"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={budgetMode}
            onChange={(e) =>
              onBudgetModeChange(e.target.value as "unchanged" | "set" | "clear")
            }
          >
            <option value="unchanged">Leave unchanged</option>
            <option value="set">Set to…</option>
            <option value="clear">Clear budget</option>
          </select>
        </label>

        {budgetMode === "set" ? (
          <label className="flex min-w-[12rem] flex-col gap-1 text-xs text-muted-foreground">
            Budget value
            <select
              aria-label="Mass edit budget"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={budgetId}
              onChange={(e) => onBudgetChange(e.target.value)}
            >
              <option value="">Choose budget…</option>
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {!confirmOpen ? (
          <Button
            type="button"
            size="sm"
            disabled={!canApply || applying}
            onClick={onApplyClick}
          >
            Apply to selected
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              Update {selectedCount} transaction{selectedCount === 1 ? "" : "s"}?
            </span>
            <Button
              type="button"
              size="sm"
              disabled={applying}
              onClick={onConfirmApply}
            >
              {applying ? "Applying…" : "Confirm"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={applying}
              onClick={onCancelConfirm}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
