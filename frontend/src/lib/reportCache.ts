import type { QueryClient } from "@tanstack/react-query"

export async function invalidateReportCaches(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["normalizedTransactions"] })
}
