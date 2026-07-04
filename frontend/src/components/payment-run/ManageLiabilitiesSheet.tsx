import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { ExcludedLiability } from "@/lib/paymentRunApi"

type ManageLiabilitiesSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  excludedLiabilities: ExcludedLiability[]
  onInclude: (accountId: string) => Promise<void>
}

export function ManageLiabilitiesSheet({
  open,
  onOpenChange,
  excludedLiabilities,
  onInclude,
}: ManageLiabilitiesSheetProps) {
  const [includingId, setIncludingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleInclude(accountId: string) {
    setIncludingId(accountId)
    setError(null)
    try {
      await onInclude(accountId)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not restore liability. Try again.",
      )
    } finally {
      setIncludingId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Manage liabilities</SheetTitle>
          <SheetDescription>
            Excluded liability accounts are hidden from the worksheet table.
            Include an account to show it again, then refresh balances for owed
            amounts.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          {excludedLiabilities.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              All Firefly liability accounts are on this worksheet. Exclude an
              account from its row pencil on the worksheet or from Configure
              worksheet.
            </p>
          ) : (
            <ul className="space-y-2">
              {excludedLiabilities.map((account) => (
                <li
                  key={account.account_id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>{account.name ?? account.account_id}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={includingId !== null}
                    onClick={() => void handleInclude(account.account_id)}
                  >
                    {includingId === account.account_id
                      ? "Including…"
                      : "Include"}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>

        <SheetFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
