import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

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
import {
  dependentsHubPath,
  externalLinkDependentsTotal,
  formatDependentsBreakdown,
} from "@/lib/externalLinkUtils"
import type { ExternalLink } from "@/lib/paymentRunApi"

type ExternalLinkSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  link: ExternalLink | null
  onSave: (values: { id?: string; label: string; url: string }) => Promise<void>
  onDelete?: (linkId: string) => Promise<void>
}

const SECTION_LINK_CONFIG = [
  { key: "bills" as const, singular: "bill" },
  { key: "liabilities" as const, singular: "liability" },
  { key: "buckets" as const, singular: "bucket" },
  { key: "accounts" as const, singular: "account" },
]

function formatEntityLabel(count: number, singular: string): string {
  const noun = count === 1 ? singular : `${singular}s`
  return `${count} ${noun}`
}

export function ExternalLinkSheet({
  open,
  onOpenChange,
  link,
  onSave,
  onDelete,
}: ExternalLinkSheetProps) {
  const [label, setLabel] = useState("")
  const [url, setUrl] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dependentsTotal = useMemo(
    () => (link ? externalLinkDependentsTotal(link.dependents) : 0),
    [link],
  )

  const dependentsBreakdown = useMemo(
    () => (link ? formatDependentsBreakdown(link.dependents) : ""),
    [link],
  )

  useEffect(() => {
    if (!open) return
    setLabel(link?.label ?? "")
    setUrl(link?.url ?? "")
    setConfirmDelete(false)
    setError(null)
  }, [link, open])

  async function handleSave() {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) {
      setError("Label is required.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        id: link?.id,
        label: trimmedLabel,
        url: url.trim(),
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
    if (!link?.id || !onDelete) return
    setDeleting(true)
    setError(null)
    try {
      await onDelete(link.id)
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete link. Try again.",
      )
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const usedByLinks = link
    ? SECTION_LINK_CONFIG.flatMap(({ key, singular }) => {
        const count = link.dependents[key] ?? 0
        if (count <= 0) return []
        return [
          {
            key,
            href: dependentsHubPath(key),
            text: formatEntityLabel(count, singular),
          },
        ]
      })
    : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-md"
        data-testid="external-link-sheet"
      >
        <SheetHeader>
          <SheetTitle>
            {link ? "Edit external link" : "Add external link"}
          </SheetTitle>
          <SheetDescription>
            {link
              ? "Update the label or URL. Changes apply to every entity using this link."
              : "Add a login URL for an external bank or bill-pay site. Assign it to entities from their edit sheets."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="external-link-label">
              Label
            </label>
            <Input
              id="external-link-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="external-link-url">
              URL
            </label>
            <Input
              id="external-link-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>

          {link && dependentsTotal > 0 ? (
            <div className="text-sm">
              <p>
                Used by{" "}
                <span className="font-medium">
                  {dependentsTotal}{" "}
                  {dependentsTotal === 1 ? "entity" : "entities"}
                </span>
                :{" "}
                {usedByLinks.map((item, index) => (
                  <span key={item.key}>
                    {index > 0 ? ", " : null}
                    <Link
                      to={item.href}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {item.text}
                    </Link>
                  </span>
                ))}
              </p>
            </div>
          ) : null}

          {link && dependentsTotal > 0 ? (
            <p
              className="text-muted-foreground text-sm"
              data-testid="external-link-delete-disabled"
            >
              Cannot delete — this link is used by{" "}
              <span className="font-medium text-foreground">
                {dependentsTotal}{" "}
                {dependentsTotal === 1 ? "entity" : "entities"}
              </span>
              {dependentsBreakdown ? ` (${dependentsBreakdown})` : null}.
              Remove assignments from entity edit sheets first.
            </p>
          ) : null}

          {confirmDelete && link ? (
            <div className="border-destructive/40 bg-destructive/5 space-y-3 rounded-md border p-3">
              <p className="text-sm">
                Delete <span className="font-medium">{link.label}</span>? This
                cannot be undone.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
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
                  Keep link
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : null}
        </div>

        <SheetFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t pt-3">
          {link && onDelete && dependentsTotal === 0 && !confirmDelete ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
            >
              Delete link
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving || deleting}
          >
            Discard changes
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || deleting}
          >
            {saving ? "Saving…" : "Save link"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
