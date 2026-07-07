import { buildFireflyTransactionUrl } from "@/lib/fireflyLinks"
import { formatDisplayAmount, formatDisplayDate } from "@/lib/formatDisplay"
import type { LiabilityHistoryTransaction } from "@/lib/paymentRunApi"

type LiabilityHistoryTableProps = {
  transactions: LiabilityHistoryTransaction[]
  fireflyBaseUrl?: string
}

export function LiabilityHistoryTable({
  transactions,
  fireflyBaseUrl,
}: LiabilityHistoryTableProps) {
  if (transactions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No payments in this period. Configure a loan profile to match transfers
        into this account.
      </p>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <div className="px-4 py-2.5">
        <table className="w-full min-w-[40rem] table-fixed text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:py-1 [&_th]:py-1">
          <colgroup>
            <col style={{ width: "5.5rem" }} />
            <col />
            <col style={{ width: "6.5rem" }} />
            <col style={{ width: "6.5rem" }} />
            <col style={{ width: "6.5rem" }} />
            <col style={{ width: "6.5rem" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="pr-3 text-left whitespace-nowrap">Date</th>
              <th className="pr-3 text-left">Description</th>
              <th className="pr-3 text-right whitespace-nowrap">Payment</th>
              <th className="pr-3 text-right whitespace-nowrap">Principal</th>
              <th className="pr-3 text-right whitespace-nowrap">Interest</th>
              <th className="text-right whitespace-nowrap">Escrow</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn, index) => {
              const fireflyUrl = buildFireflyTransactionUrl(
                fireflyBaseUrl,
                txn.journal_id,
              )
              const rowKey = `${txn.date}-${txn.journal_id ?? index}`
              return (
                <tr key={rowKey} className="border-t border-border/40">
                  <td className="pr-3 tabular-nums whitespace-nowrap">
                    {formatDisplayDate(txn.date)}
                  </td>
                  <td className="pr-3 truncate">
                    {fireflyUrl ? (
                      <a
                        href={fireflyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary block truncate underline-offset-2 hover:underline"
                        title={txn.description}
                      >
                        {txn.description}
                      </a>
                    ) : (
                      <span className="block truncate" title={txn.description}>
                        {txn.description}
                      </span>
                    )}
                  </td>
                  <td className="pr-3 text-right tabular-nums whitespace-nowrap">
                    {formatDisplayAmount(txn.amount)}
                  </td>
                  <td className="pr-3 text-right tabular-nums whitespace-nowrap">
                    {formatDisplayAmount(txn.principal)}
                  </td>
                  <td className="pr-3 text-right tabular-nums whitespace-nowrap">
                    {formatDisplayAmount(txn.interest)}
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap">
                    {formatDisplayAmount(txn.escrow)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
