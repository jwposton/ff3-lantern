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
import {
  parsePaymentDueDayInput,
} from "@/lib/paymentRunFormat"
import type { CreditCardRow, FundingBucketRollup } from "@/lib/paymentRunApi"

export type CreditCardDetailsInput = {
  funding_bucket_key: string | null
  credit_limit: string | null
  default_planned_payment: string | null
  payment_due_day: string | null
  apr_percent: string | null
}

type CreditCardSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: CreditCardRow | null
  buckets: FundingBucketRollup[]
  onSave: (accountId: string, values: CreditCardDetailsInput) => Promise<void>
  onExclude: (row: CreditCardRow) => Promise<void>
}

export function CreditCardSheet({
  open,
  onOpenChange,
  row,
  buckets,
  onSave,
  onExclude,
}: CreditCardSheetProps) {
  const [bucketKey, setBucketKey] = useState("")
  const [creditLimit, setCreditLimit] = useState("")
  const [defaultPay, setDefaultPay] = useState("")
  const [dueDay, setDueDay] = useState("")
  const [aprPercent, setAprPercent] = useState("")
  const [saving, setSaving] = useState(false)
  const [excluding, setExcluding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !row) return
    setBucketKey(row.funding_bucket_key ?? "")
    setCreditLimit(row.credit_limit ?? "")
    setDefaultPay(row.default_planned_payment ?? "")
    setDueDay(row.payment_due_day ?? "")
    setAprPercent(row.apr_percent ?? "")
    setError(null)
  }, [open, row])

  async function handleSave() {
    if (!row) return
    const trimmedDue = dueDay.trim()
    const paymentDueDay = parsePaymentDueDayInput(trimmedDue)
    if (trimmedDue && paymentDueDay === null) {
      setError("Payment due day must be between 1 and 31.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(row.account_id, {
        funding_bucket_key: bucketKey ? bucketKey : null,
        credit_limit: creditLimit.trim() === "" ? null : creditLimit.trim(),
        default_planned_payment:
          defaultPay.trim() === "" ? null : defaultPay.trim(),
        payment_due_day: paymentDueDay,
        apr_percent: aprPercent.trim() === "" ? null : aprPercent.trim(),
      })
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save card details.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleExclude() {
    if (!row) return
    const label = row.name ?? row.account_id
    if (
      !window.confirm(
        `Remove ${label} from this worksheet? You can add it back from Manage cards.`,
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
        err instanceof Error ? err.message : "Could not exclude card.",
      )
    } finally {
      setExcluding(false)
    }
  }

  const cardName = row?.name ?? row?.account_id ?? "Credit card"
  const busy = saving || excluding

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{cardName}</SheetTitle>
          <SheetDescription>
            Saved in the worksheet profile on this Firefly account (notes).
            Firefly&apos;s own due-date field on asset cards does not persist via
            the API, so it is not shown on the Firefly account page.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="cc-bucket">
              Funding bucket
            </label>
            <select
              id="cc-bucket"
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

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="cc-credit-limit">
              Credit limit
            </label>
            <Input
              id="cc-credit-limit"
              inputMode="decimal"
              value={creditLimit}
              onChange={(event) => setCreditLimit(event.target.value)}
              placeholder="e.g. 10000"
            />
            <p className="text-muted-foreground text-xs">
              Used for utilization % on the worksheet.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="cc-default-pay">
              Default pay
            </label>
            <Input
              id="cc-default-pay"
              inputMode="decimal"
              value={defaultPay}
              onChange={(event) => setDefaultPay(event.target.value)}
              placeholder="Optional"
            />
            <p className="text-muted-foreground text-xs">
              Seeds planned amount on refresh when not overridden.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="cc-due-day">
              Payment due day
            </label>
            <Input
              id="cc-due-day"
              inputMode="numeric"
              min={1}
              max={31}
              value={dueDay}
              onChange={(event) => setDueDay(event.target.value)}
              placeholder="1–31"
            />
            <p className="text-muted-foreground text-xs">
              Day of month (1–31) for your own reference on this worksheet.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="cc-apr">
              APR %
            </label>
            <Input
              id="cc-apr"
              inputMode="decimal"
              value={aprPercent}
              onChange={(event) => setAprPercent(event.target.value)}
              placeholder="e.g. 24.99"
            />
            <p className="text-muted-foreground text-xs">
              Worksheet reference only — not shown in Firefly for asset cards.
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
