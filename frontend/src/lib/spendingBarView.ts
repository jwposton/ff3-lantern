export type SpendingBarViewMode = "combined" | "split"

const VALID_MODES = new Set<SpendingBarViewMode>(["combined", "split"])

export function parseSpendingBarViewMode(
  value: string | null,
): SpendingBarViewMode {
  if (value != null && VALID_MODES.has(value as SpendingBarViewMode)) {
    return value as SpendingBarViewMode
  }
  return "combined"
}

export function spendingBarViewSearchParam(
  mode: SpendingBarViewMode,
): string | null {
  return mode === "combined" ? null : mode
}
