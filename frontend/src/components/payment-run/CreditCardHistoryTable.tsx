import { Badge } from "@/components/ui/badge"
import { buildFireflyTransactionUrl } from "@/lib/fireflyLinks"
import { formatDisplayAmount, formatDisplayDate } from "@/lib/formatDisplay"
import type { CreditCardHistoryTransaction } from "@/lib/paymentRunApi"

function kindLabel(kind: CreditCardHistoryTransaction["kind"]): string {
  switch (kind) {
    case "charge":
      return "Charge"
    case "interest":
      return "Interest"
    case "fee":
      return "Fee"
    case "payment":
      return "Payment"
  }
}

function kindVariant(
  kind: CreditCardHistoryTransaction["kind"],
): "default" | "secondary" | "outline" {
  if (kind === "payment") return "default"
  if (kind === "charge") return "secondary"
  return "outline"
}

type CreditCardHistoryTableProps = {
  transactions: CreditCardHistoryTransaction[]
  fireflyBaseUrl?: string
}

export function CreditCardHistoryTable({
  transactions,
  fireflyBaseUrl,
}: CreditCardHistoryTableProps) {
  if (transactions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No transactions in this period.
      </p>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <div className="px-4 py-2.5">
        <table className="w-full min-w-[36rem] table-fixed text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:py-1 [&_th]:py-1">
          <colgroup>
            <col style={{ width: "5.5rem" }} />
            <col style={{ width: "5.5rem" }} />
            <col style={{ width: "7rem" }} />
            <col />
            <col style={{ width: "7rem" }} />
            <col style={{ width: "5.5rem" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="pr-3 text-left whitespace-nowrap">Date</th>
              <th className="pr-3 text-left whitespace-nowrap">Kind</th>
              <th className="pr-3 text-left">Payee</th>
              <th className="pr-3 text-left">Description</th>
              <th className="pr-3 text-left">Category</th>
              <th className="text-right whitespace-nowrap">Amount</th>
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
                  <td className="pr-3">
                    <Badge variant={kindVariant(txn.kind)} className="text-[10px]">
                      {kindLabel(txn.kind)}
                    </Badge>
                  </td>
                  <td
                    className="text-muted-foreground pr-3 truncate"
                    title={txn.payee ?? undefined}
                  >
                    {txn.payee ?? "—"}
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
                  <td
                    className="text-muted-foreground pr-3 truncate"
                    title={txn.category ?? undefined}
                  >
                    {txn.category ?? "—"}
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap">
                    {formatDisplayAmount(txn.amount)}
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
