import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { LoanAccountOption } from "@/lib/loanApi"
import type { FundingBucket } from "@/lib/paymentRunApi"

type BucketSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  bucket: FundingBucket | null
  assetAccounts: LoanAccountOption[]
  onSave: (values: {
    id?: string
    label: string
    sort_order: number
    firefly_account_ids: string[]
  }) => Promise<void>
}

export function BucketSheet({
  open,
  onOpenChange,
  bucket,
  assetAccounts,
  onSave,
}: BucketSheetProps) {
  const [label, setLabel] = useState("")
  const [sortOrder, setSortOrder] = useState("0")
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLabel(bucket?.label ?? "")
    setSortOrder(String(bucket?.sort_order ?? 0))
    const accountIds = bucket?.firefly_account_ids ?? []
    setSelectedAccountIds(accountIds)
    setError(null)
  }, [bucket, open])

  function toggleAccount(accountId: string) {
    setSelectedAccountIds((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId],
    )
  }

  async function handleSave() {
    const trimmed = label.trim()
    if (!trimmed) {
      setError("Bucket label is required.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        id: bucket?.id,
        label: trimmed,
        sort_order: Number.parseInt(sortOrder, 10) || 0,
        firefly_account_ids: selectedAccountIds,
      })
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save changes. Try again.",
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {bucket ? "Edit funding bucket" : "Add funding bucket"}
          </SheetTitle>
          <SheetDescription>
            Map checking or savings accounts in Firefly to this bucket.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="bucket-label">
              Label
            </label>
            <Input
              id="bucket-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="bucket-sort">
              Sort order
            </label>
            <Input
              id="bucket-sort"
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Firefly accounts</p>
            {assetAccounts.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No asset accounts available from Firefly.
              </p>
            ) : (
              <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
                {assetAccounts.map((account) => (
                  <li key={account.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedAccountIds.includes(account.id)}
                        onChange={() => toggleAccount(account.id)}
                      />
                      <span>{account.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : null}
        </div>

        <SheetFooter className="gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Close without saving
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            Save bucket
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
