export const STORAGE_KEY = "ff3-worksheet-bill-group-expanded"

export function readExpandedBillGroups(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return new Set()
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return new Set()
    const ids = parsed.filter((item): item is string => typeof item === "string")
    return new Set(ids)
  } catch {
    return new Set()
  }
}

export function writeExpandedBillGroups(ids: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
}
