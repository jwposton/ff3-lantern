import { useEffect, useState } from "react"
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
import type { FundingBucketRollup, LiabilityRow } from "@/lib/paymentRunApi"

export type LiabilityAccountDetailsInput = {
  funding_bucket_key: string | null
  default_planned_payment: string | null
}

type LiabilityAccountSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: LiabilityRow | null
  buckets: FundingBucketRollup[]
  loanConfigured?: boolean
  loanExpectedAmount?: string | null
  onSave: (accountId: string, values: LiabilityAccountDetailsInput) => Promise<void>
  onExclude: (row: LiabilityRow) => Promise<void>
}

export function LiabilityAccountSheet({
  open,
  onOpenChange,
  row,
  buckets,
  loanConfigured = false,
  loanExpectedAmount = null,
  onSave,
  onExclude,
}: LiabilityAccountSheetProps) {
  const [bucketKey, setBucketKey] = useState("")
  const [defaultPay, setDefaultPay] = useState("")
  const [saving, setSaving] = useState(false)
  const [excluding, setExcluding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !row) return
    setBucketKey(row.funding_bucket_key ?? "")
    setDefaultPay(row.default_planned_payment ?? "")
    setError(null)
  }, [open, row])

  async function handleSave() {
    if (!row?.account_id) return
    setSaving(true)
    setError(null)
    try {
      await onSave(row.account_id, {
        funding_bucket_key: bucketKey ? bucketKey : null,
        default_planned_payment:
          defaultPay.trim() === "" ? null : defaultPay.trim(),
      })
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save liability account details.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleExclude() {
    if (!row) return
    const label = row.name ?? row.account_id ?? "Liability"
    if (
      !window.confirm(
        `Remove ${label} from this worksheet? You can add it back from Configure worksheet.`,
      )
    ) {
      return
    }
    setExcluding(true)
    setError(null)
    try {
      await onExclude(row)
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not exclude liability.",
      )
    } finally {
      setExcluding(false)
    }
  }

  const accountName = row?.name ?? row?.account_id ?? "Liability account"
  const busy = saving || excluding

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{accountName}</SheetTitle>
          <SheetDescription>
            Worksheet settings stored in this Firefly liability account&apos;s
            notes. Auto-draft planned amounts come from the loan profile when
            configured.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="liability-bucket">
              Funding bucket
            </label>
            <select
              id="liability-bucket"
              className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"
              value={bucketKey}
              onChange={(event) => setBucketKey(event.target.value)}
            >
              <option value="">Unassigned</option>
              {buckets.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>
                  {bucket.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">Loan profile</p>
            {loanConfigured ? (
              <p className="text-muted-foreground mt-1">
                Configured
                {loanExpectedAmount
                  ? ` — auto-draft ${loanExpectedAmount}/mo from expected payment`
                  : " — expected payment set in profile"}
              </p>
            ) : (
              <p className="text-muted-foreground mt-1">
                Not configured — auto-draft will be $0 until you set up the loan
                profile.
              </p>
            )}
            {row?.account_id ? (
              <Button
                asChild
                variant="link"
                size="sm"
                className="mt-1 h-auto px-0"
              >
                <Link to={`/manage/loans/${row.account_id}`}>
                  {loanConfigured ? "Edit loan profile" : "Configure loan profile"}
                </Link>
              </Button>
            ) : null}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="liability-default-pay">
              Fallback planned payment
            </label>
            <Input
              id="liability-default-pay"
              inputMode="decimal"
              value={defaultPay}
              onChange={(event) => setDefaultPay(event.target.value)}
              placeholder="Optional"
            />
            <p className="text-muted-foreground text-xs">
              Used on refresh only when no loan profile expected amount exists.
            </p>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>

        <SheetFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t pt-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void handleExclude()}
            disabled={busy}
          >
            {excluding ? "Removing…" : "Exclude"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={busy}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
