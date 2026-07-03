import { useQuery } from "@tanstack/react-query"

import {
  currentMonthKey,
  fetchPaymentWorksheet,
  type PaymentWorksheetEnvelope,
} from "@/lib/paymentRunApi"

export function paymentRunQueryKey(month: string) {
  return ["paymentRun", month] as const
}

export function usePaymentWorksheet(month: string = currentMonthKey()) {
  return useQuery({
    queryKey: paymentRunQueryKey(month),
    queryFn: () => fetchPaymentWorksheet(month),
    staleTime: 1000 * 60 * 2,
  })
}

export type { PaymentWorksheetEnvelope }
