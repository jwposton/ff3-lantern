/** Demo clock — synced from GET /health demo_anchor_date (FF3LANTERN_DEMO_ANCHOR_DATE). */

let demoAnchorDate: string | null = null

export function setDemoAnchorDate(value: string | null | undefined): void {
  const trimmed = value?.trim()
  demoAnchorDate = trimmed ? trimmed : null
}

export function getDemoAnchorDate(): string | null {
  return demoAnchorDate
}

export function referenceDate(): Date {
  if (demoAnchorDate) {
    const [year, month, day] = demoAnchorDate.split("-").map(Number)
    return new Date(year, month - 1, day)
  }
  return new Date()
}

export function currentMonthKey(): string {
  const ref = referenceDate()
  const year = ref.getFullYear()
  const month = String(ref.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

export function currentCalendarMonth(): string {
  return currentMonthKey()
}

export function formatDemoAnchorLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number)
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}
