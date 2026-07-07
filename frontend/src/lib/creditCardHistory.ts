import type {
  CreditCardHistoryEnvelope,
  CreditCardHistoryTotals,
} from "@/lib/paymentRunApi"

export function parseHistoryAmount(value: string | null | undefined): number {
  if (value == null || value === "") return 0
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : 0
}

export function sumHistoryAmounts(values: string[]): string {
  const total = values.reduce((acc, value) => acc + parseHistoryAmount(value), 0)
  return total.toFixed(2)
}

export function computeCreditCardNetChange(totals: {
  charges: string
  interest: string
  payments: string
}): string {
  const net =
    parseHistoryAmount(totals.charges) +
    parseHistoryAmount(totals.interest) -
    parseHistoryAmount(totals.payments)
  return net.toFixed(2)
}

/** Positive net change = balance grew (red); negative = paid down (green). */
export function creditCardNetChangeClassName(
  value: string | number | null | undefined,
): string {
  const amount = parseHistoryAmount(
    value == null ? "" : typeof value === "number" ? String(value) : value,
  )
  if (amount > 0) {
    return "text-destructive"
  }
  if (amount < 0) {
    return "text-emerald-600 dark:text-emerald-400"
  }
  return ""
}

export function aggregateCreditCardPortfolioTotals(
  histories: CreditCardHistoryEnvelope[],
): CreditCardHistoryTotals {
  const charges = sumHistoryAmounts(histories.map((row) => row.totals.charges))
  const fees = sumHistoryAmounts(histories.map((row) => row.totals.fees))
  const interest = sumHistoryAmounts(histories.map((row) => row.totals.interest))
  const payments = sumHistoryAmounts(histories.map((row) => row.totals.payments))
  return {
    charges,
    fees,
    interest,
    payments,
    net_change: computeCreditCardNetChange({ charges, interest, payments }),
  }
}

export function sumCardBalances(owedValues: string[]): string {
  return sumHistoryAmounts(owedValues)
}

export function formatStatsWindowCaption(
  statsWindow: { start: string; end: string } | undefined,
): string | null {
  if (!statsWindow) return null
  const [startYear, startMonth] = statsWindow.start.split("-").map(Number)
  const [endYear, endMonth] = statsWindow.end.split("-").map(Number)
  if (!startYear || !startMonth || !endYear || !endMonth) return null
  const startDate = new Date(startYear, startMonth - 1, 1)
  const endDate = new Date(endYear, endMonth, 0)
  const startPart = startDate.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  })
  const endPart = endDate.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  })
  return `${startPart} – ${endPart}`
}
