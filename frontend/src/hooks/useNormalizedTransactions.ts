import { useQuery } from "@tanstack/react-query"

import { isValidRange } from "@/lib/dateRange"
import type { OmniRow } from "@/types/NormalizedTransaction"

export type NormalizedTransactionsMeta = {
  count: number
  start: string
  end: string
}

export type NormalizedTransactionsResponse = {
  data: OmniRow[]
  firefly_base_url?: string
  meta?: NormalizedTransactionsMeta
}

async function fetchNormalizedTransactions(
  start: string,
  end: string,
): Promise<NormalizedTransactionsResponse> {
  const params = new URLSearchParams({ start, end })
  const res = await fetch(`/api/normalized_transactions?${params}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch normalized transactions (${res.status})`)
  }
  const json = (await res.json()) as Record<string, unknown>
  return {
    data: Array.isArray(json.data) ? (json.data as OmniRow[]) : [],
    firefly_base_url:
      typeof json.firefly_base_url === "string"
        ? json.firefly_base_url
        : undefined,
    meta:
      json.meta != null && typeof json.meta === "object"
        ? (json.meta as NormalizedTransactionsMeta)
        : undefined,
  }
}

export function useNormalizedTransactions(
  start: string,
  end: string,
  options?: { enabled?: boolean },
) {
  const rangeValid = Boolean(start && end && isValidRange(start, end))
  const enabled = options?.enabled !== false && rangeValid

  return useQuery<NormalizedTransactionsResponse, Error>({
    queryKey: ["normalizedTransactions", start, end],
    queryFn: () => fetchNormalizedTransactions(start, end),
    enabled,
    staleTime: 1000 * 60 * 5,
  })
}
