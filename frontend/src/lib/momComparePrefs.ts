import type { MomTopNFamily } from "@/lib/momTopN"

export type MomCompareMode = "month-pair" | "vs-average"
export type RollingWindowMonths = 3 | 6 | 9 | 12
export type RollingAverageMethod = "mean" | "median"

export const ROLLING_WINDOW_OPTIONS: RollingWindowMonths[] = [3, 6, 9, 12]
export const DEFAULT_ROLLING_WINDOW: RollingWindowMonths = 6
export const DEFAULT_COMPARE_MODE: MomCompareMode = "vs-average"
export const DEFAULT_ROLLING_AVERAGE_METHOD: RollingAverageMethod = "mean"

const MODE_KEYS: Record<MomTopNFamily, string> = {
  spending: "ff3-spending-mom-compare-mode",
  "cash-flow": "ff3-cash-flow-mom-compare-mode",
}

const WINDOW_KEYS: Record<MomTopNFamily, string> = {
  spending: "ff3-spending-mom-rolling-window",
  "cash-flow": "ff3-cash-flow-mom-rolling-window",
}

const AVERAGE_METHOD_KEYS: Record<MomTopNFamily, string> = {
  spending: "ff3-spending-mom-rolling-average-method",
  "cash-flow": "ff3-cash-flow-mom-rolling-average-method",
}

function parseCompareMode(value: string | null): MomCompareMode {
  return value === "month-pair" ? "month-pair" : "vs-average"
}

function parseRollingWindow(value: string | null): RollingWindowMonths {
  const n = value ? parseInt(value, 10) : DEFAULT_ROLLING_WINDOW
  return ROLLING_WINDOW_OPTIONS.includes(n as RollingWindowMonths)
    ? (n as RollingWindowMonths)
    : DEFAULT_ROLLING_WINDOW
}

export function readMomCompareMode(family: MomTopNFamily): MomCompareMode {
  return parseCompareMode(localStorage.getItem(MODE_KEYS[family]))
}

export function writeMomCompareMode(
  family: MomTopNFamily,
  mode: MomCompareMode,
): void {
  localStorage.setItem(MODE_KEYS[family], mode)
}

export function readMomRollingWindow(family: MomTopNFamily): RollingWindowMonths {
  return parseRollingWindow(localStorage.getItem(WINDOW_KEYS[family]))
}

export function writeMomRollingWindow(
  family: MomTopNFamily,
  window: RollingWindowMonths,
): void {
  localStorage.setItem(WINDOW_KEYS[family], String(window))
}

function parseRollingAverageMethod(value: string | null): RollingAverageMethod {
  return value === "median" ? "median" : "mean"
}

export function readMomRollingAverageMethod(
  family: MomTopNFamily,
): RollingAverageMethod {
  return parseRollingAverageMethod(
    localStorage.getItem(AVERAGE_METHOD_KEYS[family]),
  )
}

export function writeMomRollingAverageMethod(
  family: MomTopNFamily,
  method: RollingAverageMethod,
): void {
  localStorage.setItem(AVERAGE_METHOD_KEYS[family], method)
}
