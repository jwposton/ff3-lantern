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
import type { ExcludedCreditCard } from "@/lib/paymentRunApi"

type ManageCardsSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  excludedCards: ExcludedCreditCard[]
  onInclude: (accountId: string) => Promise<void>
}

export function ManageCardsSheet({
  open,
  onOpenChange,
  excludedCards,
  onInclude,
}: ManageCardsSheetProps) {
  const [includingId, setIncludingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleInclude(accountId: string) {
    setIncludingId(accountId)
    setError(null)
    try {
      await onInclude(accountId)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not restore card. Try again.",
      )
    } finally {
      setIncludingId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Manage cards</SheetTitle>
          <SheetDescription>
            Excluded cards are hidden from the worksheet table. Include a card to
            show it again, then refresh balances for owed amounts.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          {excludedCards.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              All Firefly credit card accounts are on this worksheet. Exclude a
              card from its Details sheet (pencil icon in the table).
            </p>
          ) : (
            <ul className="space-y-2">
              {excludedCards.map((card) => (
                <li
                  key={card.account_id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>{card.name ?? card.account_id}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={includingId !== null}
                    onClick={() => void handleInclude(card.account_id)}
                  >
                    {includingId === card.account_id ? "Including…" : "Include"}
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
