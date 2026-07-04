import { useQuery } from "@tanstack/react-query"

import {
  fetchBillHistory,
  fetchRegisteredBills,
  type BillHistoryEnvelope,
} from "@/lib/paymentRunApi"

export function registeredBillsQueryKey() {
  return ["paymentRun", "registeredBills"] as const
}

export function billHistoryQueryKey(registryId: number) {
  return ["paymentRun", "billHistory", registryId] as const
}

export function useRegisteredBills() {
  return useQuery({
    queryKey: registeredBillsQueryKey(),
    queryFn: fetchRegisteredBills,
    staleTime: 1000 * 60 * 2,
  })
}

export function useBillHistory(registryId: number | null) {
  return useQuery({
    queryKey: billHistoryQueryKey(registryId ?? 0),
    queryFn: () => fetchBillHistory(registryId!),
    enabled: registryId != null,
    staleTime: 1000 * 60 * 2,
  })
}

export type { BillHistoryEnvelope }
