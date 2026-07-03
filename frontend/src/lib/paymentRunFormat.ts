/** Format worksheet payment due day (1–31). */
export function formatPaymentDueDay(
  day: string | null | undefined,
): string {
  if (!day) return "—"
  const n = Number.parseInt(day, 10)
  if (!Number.isFinite(n) || n < 1 || n > 31) return "—"
  return String(n)
}

export function parsePaymentDueDayInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(n) || n < 1 || n > 31) return null
  return String(n)
}

export function formatInterestPercent(
  aprPercent: string | null | undefined,
): string {
  if (!aprPercent) return "—"
  const value = Number.parseFloat(aprPercent)
  if (!Number.isFinite(value)) return "—"
  return `${value}%`
}

function parseDueDay(day: string | null | undefined): number | null {
  if (!day) return null
  const n = Number.parseInt(day, 10)
  if (!Number.isFinite(n) || n < 1 || n > 31) return null
  return n
}

/** Due today or earlier in the worksheet month (only when worksheet month is the calendar month). */
export function isPaymentDueUrgent(
  paymentDueDay: string | null | undefined,
  worksheetMonth: string,
  referenceDate: Date = new Date(),
): boolean {
  const dueDay = parseDueDay(paymentDueDay)
  if (dueDay == null) return false

  const [wsYear, wsMonth] = worksheetMonth.split("-").map(Number)
  const refYear = referenceDate.getFullYear()
  const refMonth = referenceDate.getMonth() + 1
  if (wsYear !== refYear || wsMonth !== refMonth) return false

  const today = referenceDate.getDate()
  return dueDay <= today
}

export function isLastPaymentInWorksheetMonth(
  lastPaymentDate: string | null | undefined,
  worksheetMonth: string,
): boolean {
  if (!lastPaymentDate) return false
  return lastPaymentDate.slice(0, 7) === worksheetMonth
}

/** Red due-date alert: urgent due, not marked paid, no bank payment this month yet. */
export function shouldHighlightCreditCardDue(
  input: {
    payment_due_day: string | null
    last_payment_date: string | null
    paid_at: string | null
  },
  worksheetMonth: string,
  referenceDate: Date = new Date(),
): boolean {
  if (input.paid_at) return false
  if (isLastPaymentInWorksheetMonth(input.last_payment_date, worksheetMonth)) {
    return false
  }
  return isPaymentDueUrgent(
    input.payment_due_day,
    worksheetMonth,
    referenceDate,
  )
}

export type CreditCardSubtotalInput = {
  credit_limit: string | null
  apr_percent: string | null
  owed: string
  last_payment_amount: string
  new_total: string
  interest_accrued: string
  fees: string
  planned_amount: string
  paid_at: string | null
}

export type CreditCardSubtotals = {
  credit_limit: number
  weighted_apr: number | null
  portfolio_util: number | null
  owed: number
  last_payment_amount: number
  new_total: number
  interest_accrued: number
  fees: number
  planned_amount: number
  paid_count: number
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Aggregate CC table numerics; APR is balance-weighted, util is total owed / total limits. */
export function computeCreditCardSubtotals(
  rows: CreditCardSubtotalInput[],
): CreditCardSubtotals {
  let creditLimit = 0
  let owed = 0
  let lastPaymentAmount = 0
  let newTotal = 0
  let interestAccrued = 0
  let fees = 0
  let plannedAmount = 0
  let paidCount = 0
  let aprWeightedSum = 0
  let aprWeightTotal = 0

  for (const row of rows) {
    const rowOwed = Math.abs(parseAmount(row.owed))
    const rowLimit = parseAmount(row.credit_limit)
    const rowApr = parseAmount(row.apr_percent)

    owed += rowOwed
    creditLimit += rowLimit
    lastPaymentAmount += parseAmount(row.last_payment_amount)
    newTotal += parseAmount(row.new_total)
    interestAccrued += parseAmount(row.interest_accrued)
    fees += parseAmount(row.fees)
    plannedAmount += parseAmount(row.planned_amount)
    if (row.paid_at) paidCount += 1

    if (rowOwed > 0 && row.apr_percent && Number.isFinite(rowApr)) {
      aprWeightedSum += rowOwed * rowApr
      aprWeightTotal += rowOwed
    }
  }

  return {
    credit_limit: creditLimit,
    weighted_apr:
      aprWeightTotal > 0 ? aprWeightedSum / aprWeightTotal : null,
    portfolio_util:
      creditLimit > 0 ? (owed / creditLimit) * 100 : null,
    owed,
    last_payment_amount: lastPaymentAmount,
    new_total: newTotal,
    interest_accrued: interestAccrued,
    fees,
    planned_amount: plannedAmount,
    paid_count: paidCount,
  }
}
