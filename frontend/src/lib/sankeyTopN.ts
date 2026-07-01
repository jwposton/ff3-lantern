import {
  TOP_N_DEFAULT,
  TOP_N_MAX,
  TOP_N_MIN,
} from "@/lib/topNConstants"

export const STORAGE_KEY = "ff3-spending-sankey-top-n"

export function readSankeyTopN(): number {
  const stored = localStorage.getItem(STORAGE_KEY)
  const n = stored ? parseInt(stored, 10) : TOP_N_DEFAULT
  return Number.isFinite(n)
    ? Math.min(TOP_N_MAX, Math.max(TOP_N_MIN, n))
    : TOP_N_DEFAULT
}

export function writeSankeyTopN(value: number): void {
  localStorage.setItem(
    STORAGE_KEY,
    String(Math.min(TOP_N_MAX, Math.max(TOP_N_MIN, value))),
  )
}
