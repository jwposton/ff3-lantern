import type {
  LiabilityHistoryEnvelope,
  LiabilityHistoryTotals,
} from "@/lib/paymentRunApi"

import { parseHistoryAmount, sumHistoryAmounts } from "@/lib/creditCardHistory"

export { formatStatsWindowCaption } from "@/lib/creditCardHistory"

export function aggregateLiabilityPortfolioTotals(
  histories: LiabilityHistoryEnvelope[],
): LiabilityHistoryTotals {
  return {
    principal: sumHistoryAmounts(histories.map((row) => row.totals.principal)),
    interest: sumHistoryAmounts(histories.map((row) => row.totals.interest)),
    total_payment: sumHistoryAmounts(
      histories.map((row) => row.totals.total_payment),
    ),
  }
}

export function sumLiabilityBalances(owedValues: string[]): string {
  return sumHistoryAmounts(owedValues)
}

export { parseHistoryAmount }
