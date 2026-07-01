import type { QueryClient } from "@tanstack/react-query"

export async function invalidateReportCaches(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["normalizedTransactions"] }),
    queryClient.invalidateQueries({ queryKey: ["categorizeMeta"] }),
    queryClient.invalidateQueries({ queryKey: ["loanMeta"] }),
  ])
}
