import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useBillSuggestionExplain } from "@/hooks/useBillSuggestionExplain"
import { formatDisplayAmount } from "@/lib/formatDisplay"
import { cn } from "@/lib/utils"

type BillSuggestionExplainDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  suggestionId: string | null
  merchant: string
  lookbackMonths: number
}

export function isStaleConfidenceNote(
  note: string | null | undefined,
): boolean {
  if (!note?.trim()) return false
  const n = note.toLowerCase()
  return (
    n.includes("cancel") ||
    n.includes("no recent") ||
    n.includes("stale") ||
    n.includes("inactive") ||
    n.includes("stopped")
  )
}

function displayOrDash(value: string | null | undefined): string {
  if (value == null || !String(value).trim()) return "—"
  return value
}

function formatRuleHintAmount(value: string | null | undefined): string {
  if (value == null || !String(value).trim()) return "—"
  const trimmed = String(value).trim()
  const numeric = Number(trimmed)
  if (!Number.isNaN(numeric)) return formatDisplayAmount(numeric)
  return trimmed
}

function LabeledField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm leading-relaxed">{value}</p>
    </div>
  )
}

export function BillSuggestionExplainDialog({
  open,
  onOpenChange,
  suggestionId,
  merchant,
  lookbackMonths,
}: BillSuggestionExplainDialogProps) {
  const { data, isPending, isFetching, isError, refetch } =
    useBillSuggestionExplain(suggestionId, lookbackMonths, open)

  const initialLoading = isPending && !data
  const staleCallout =
    data != null && isStaleConfidenceNote(data.confidence_note)
  const showConfidenceField =
    data != null &&
    displayOrDash(data.confidence_note) !== "—" &&
    !staleCallout

  const descriptionSuffix =
    lookbackMonths !== 12 ? ` · ${lookbackMonths}-month lookback` : ""

  const handleOpenChange = (next: boolean) => {
    if (!next && initialLoading) return
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            AI explanation
          </DialogTitle>
          <DialogDescription>
            {merchant}
            {descriptionSuffix}
          </DialogDescription>
        </DialogHeader>

        <div
          className="space-y-4 px-1"
          aria-busy={initialLoading ? "true" : undefined}
        >
          {initialLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full max-w-md" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-5 w-3/4" />
            </div>
          ) : null}

          {!initialLoading && isError ? (
            <div
              role="alert"
              className="rounded border border-destructive/50 bg-destructive/10 p-3"
            >
              <p className="text-destructive text-sm">
                Could not load AI explanation for this suggestion.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void refetch()}
              >
                Try again
              </Button>
            </div>
          ) : null}

          {!initialLoading && !isError && data != null ? (
            <>
              {staleCallout ? (
                <div
                  role="status"
                  className="rounded-md border border-amber-500/50 bg-amber-50/60 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
                >
                  {data.confidence_note}
                </div>
              ) : null}

              <LabeledField
                label="Suggested bill name"
                value={displayOrDash(data.display_name)}
              />
              <LabeledField
                label="Service"
                value={displayOrDash(data.service_guess)}
              />
              <LabeledField
                label="Amount mode"
                value={displayOrDash(data.amount_mode_rationale)}
              />

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Suggested rule hints
                </p>
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <LabeledField
                    label="Payee account"
                    value={displayOrDash(data.rule_hints.destination_account)}
                  />
                  <LabeledField
                    label="Category"
                    value={displayOrDash(data.rule_hints.category_name)}
                  />
                  <LabeledField
                    label="Exact amount"
                    value={formatRuleHintAmount(data.rule_hints.amount_exactly)}
                  />
                </div>
              </div>

              <LabeledField
                label="Rationale"
                value={displayOrDash(data.rationale)}
              />

              {showConfidenceField ? (
                <LabeledField
                  label="Confidence"
                  value={displayOrDash(data.confidence_note)}
                />
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetching || initialLoading}
            aria-label="Refresh AI explanation"
            onClick={() => void refetch()}
          >
            <RefreshCw
              className={cn("mr-2 size-4", isFetching && "animate-spin")}
            />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="outline" size="sm">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
