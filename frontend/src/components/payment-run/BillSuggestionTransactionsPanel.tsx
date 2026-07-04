import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useBillSuggestionTransactions } from "@/hooks/useBillSuggestionTransactions"
import { formatDisplayAmount, formatDisplayDate } from "@/lib/formatDisplay"

type BillSuggestionTransactionsPanelProps = {
  suggestionId: string
  merchant: string
  lookbackMonths: number
  isExpanded: boolean
}

function displayOrDash(value: string | null | undefined): string {
  if (value == null || !String(value).trim()) return "—"
  return value
}

export function BillSuggestionTransactionsPanel({
  suggestionId,
  merchant,
  lookbackMonths,
  isExpanded,
}: BillSuggestionTransactionsPanelProps) {
  const panelId = `discover-txn-panel-${suggestionId}`
  const { data, isPending, isFetching, isError, refetch } =
    useBillSuggestionTransactions(suggestionId, lookbackMonths, isExpanded)

  if (!isExpanded) return null

  const loading = isPending || (isFetching && !data)
  const transactions = data?.data ?? []

  return (
    <div
      id={panelId}
      role="region"
      aria-label={`Withdrawals for ${merchant}`}
      aria-busy={loading ? "true" : undefined}
      className="bg-muted/30 border-t px-4 py-2.5"
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full max-w-md" />
          <Skeleton className="h-6 w-5/6" />
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      ) : null}

      {!loading && isError ? (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-destructive text-sm">
            Could not load withdrawals for this suggestion.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {!loading && !isError && transactions.length === 0 ? (
        <p className="text-muted-foreground py-3 text-center text-sm">
          No withdrawals found for this suggestion in the selected lookback
          period.
        </p>
      ) : null}

      {!loading && !isError && transactions.length > 0 ? (
        <>
          <p className="text-muted-foreground mb-2 text-xs tabular-nums">
            {transactions.length} withdrawals in lookback
          </p>
          <div className="max-w-full overflow-x-auto">
            <table className="w-max max-w-full table-fixed text-xs [&_td]:py-1 [&_th]:py-1 [&_th]:font-medium [&_th]:text-muted-foreground">
              <colgroup>
                <col style={{ width: "5.5rem" }} />
                <col style={{ width: "5.5rem" }} />
                <col style={{ width: "8rem" }} />
                <col style={{ width: "7rem" }} />
                <col style={{ width: "7rem" }} />
                <col style={{ width: "6rem" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="text-left">Date</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left">Description</th>
                  <th className="text-left">Category</th>
                  <th className="text-left">Payee</th>
                  <th className="text-left">Budget</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn, index) => (
                  <tr
                    key={`${txn.date}-${txn.amount}-${index}`}
                    className="border-t border-border/40"
                  >
                    <td className="whitespace-nowrap tabular-nums">
                      {formatDisplayDate(txn.date)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatDisplayAmount(txn.amount)}
                    </td>
                    <td className="max-w-[8rem] truncate" title={txn.description}>
                      {txn.description}
                    </td>
                    <td
                      className="max-w-[7rem] truncate text-muted-foreground"
                      title={txn.category ?? undefined}
                    >
                      {displayOrDash(txn.category)}
                    </td>
                    <td
                      className="max-w-[7rem] truncate text-muted-foreground"
                      title={txn.payee ?? undefined}
                    >
                      {displayOrDash(txn.payee)}
                    </td>
                    <td
                      className="max-w-[6rem] truncate text-muted-foreground"
                      title={txn.budget ?? undefined}
                    >
                      {displayOrDash(txn.budget)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}
