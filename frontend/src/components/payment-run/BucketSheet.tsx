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
  onDelete?: (bucketId: string) => Promise<void>
}

export function BucketSheet({
  open,
  onOpenChange,
  bucket,
  assetAccounts,
  onSave,
  onDelete,
}: BucketSheetProps) {
  const [label, setLabel] = useState("")
  const [sortOrder, setSortOrder] = useState("0")
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLabel(bucket?.label ?? "")
    setSortOrder(String(bucket?.sort_order ?? 0))
    const accountIds = bucket?.firefly_account_ids ?? []
    setSelectedAccountIds(accountIds)
    setConfirmDelete(false)
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

  async function handleDelete() {
    if (!bucket?.id || !onDelete) return
    setDeleting(true)
    setError(null)
    try {
      await onDelete(bucket.id)
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete bucket. Try again.",
      )
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
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
            Link checking or savings accounts in Firefly to this cash pool.
            Credit cards are managed separately in the table below.
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
            <p className="text-sm font-medium">Checking &amp; savings accounts</p>
            {assetAccounts.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No checking or savings accounts available from Firefly.
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

          {confirmDelete && bucket ? (
            <div className="border-destructive/40 bg-destructive/5 space-y-3 rounded-md border p-3">
              <p className="text-sm">
                Delete <span className="font-medium">{bucket.label}</span>? Cards
                mapped to this bucket will show as unassigned until you pick
                another bucket.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={handleDelete}
                >
                  {deleting ? "Deleting…" : "Confirm delete"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : null}
        </div>

        <SheetFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t pt-3">
          {bucket && onDelete && !confirmDelete ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
            >
              Delete
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving || deleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || deleting}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
