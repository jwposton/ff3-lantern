import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
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
import type { BillGroup, RegisteredBillListItem } from "@/lib/paymentRunApi"

type BillGroupSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: BillGroup | null
  eligibleBills: RegisteredBillListItem[]
  onSave: (values: {
    id?: string
    label: string
    sort_order: number
    member_ids: number[]
  }) => Promise<void>
  onDelete?: (groupId: string) => Promise<void>
}

export function BillGroupSheet({
  open,
  onOpenChange,
  group,
  eligibleBills,
  onSave,
  onDelete,
}: BillGroupSheetProps) {
  const [label, setLabel] = useState("")
  const [sortOrder, setSortOrder] = useState("0")
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLabel(group?.label ?? "")
    setSortOrder(String(group?.sort_order ?? 0))
    setSelectedMemberIds(group?.members.map((member) => member.registry_id) ?? [])
    setConfirmDelete(false)
    setError(null)
  }, [group, open])

  function toggleMember(registryId: number) {
    setSelectedMemberIds((current) =>
      current.includes(registryId)
        ? current.filter((id) => id !== registryId)
        : [...current, registryId],
    )
  }

  function memberShowInGroup(registryId: number): boolean {
    return (
      group?.members.find((member) => member.registry_id === registryId)
        ?.show_in_group ?? false
    )
  }

  async function handleSave() {
    const trimmed = label.trim()
    if (!trimmed) {
      setError("Group label is required.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        id: group?.id,
        label: trimmed,
        sort_order: Number.parseInt(sortOrder, 10) || 0,
        member_ids: selectedMemberIds,
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
    if (!group?.id || !onDelete) return
    setDeleting(true)
    setError(null)
    try {
      await onDelete(group.id)
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete group. Try again.",
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
          <SheetTitle>{group ? "Edit bill group" : "Add bill group"}</SheetTitle>
          <SheetDescription>
            Assign registered bills to this group. Bills stay in the registry when
            a group is deleted — only the group link is removed.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="group-label">
              Label
            </label>
            <Input
              id="group-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="group-sort">
              Sort order
            </label>
            <Input
              id="group-sort"
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Group members</p>
            {eligibleBills.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No registered bills or liabilities available to assign.
              </p>
            ) : (
              <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
                {eligibleBills.map((bill) => (
                  <li key={bill.registry_id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.includes(bill.registry_id)}
                        onChange={() => toggleMember(bill.registry_id)}
                      />
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{bill.row_label ?? `Bill #${bill.registry_id}`}</span>
                        <Badge variant="outline" className="text-xs">
                          {bill.worksheet_section === "liabilities"
                            ? "Liabilities"
                            : "Bills"}
                        </Badge>
                        {memberShowInGroup(bill.registry_id) ? (
                          <Badge variant="secondary" className="text-xs">
                            Visible in group
                          </Badge>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {confirmDelete && group ? (
            <div className="border-destructive/40 bg-destructive/5 space-y-3 rounded-md border p-3">
              <p className="text-sm">
                Delete <span className="font-medium">{group.label}</span>? Member
                bills will be unlinked from this group but not removed from the
                registry.
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
          {group && onDelete && !confirmDelete ? (
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
