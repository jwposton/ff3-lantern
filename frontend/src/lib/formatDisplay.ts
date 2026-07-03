/** Display-only date: YYYY-MM-DD without time component. */
export function formatDisplayDate(value: string | null | undefined): string {
  if (value == null) return "—"
  const trimmed = value.trim()
  if (!trimmed) return "—"
  const datePart = trimmed.split(/[T\s]/)[0] ?? trimmed
  return datePart.length >= 10 ? datePart.slice(0, 10) : datePart
}

/** Display-only amount fixed to two decimal places. */
export function formatDisplayAmount(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—"
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value).replace(/,/g, ""))
  if (!Number.isFinite(parsed)) return String(value)
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed)
}
