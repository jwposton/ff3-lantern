import { ChevronDown } from "lucide-react"
import { useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  useDiscoverSettings,
  useIgnoreCategory,
  useIgnorePayee,
} from "@/hooks/useDiscoverSettings"
import type { BillSuggestion } from "@/lib/paymentRunApi"

type PendingAction =
  | { kind: "payee"; payeeName: string; rowCount: number }
  | { kind: "category"; categoryName: string }

type BillSuggestionIgnoreMenuProps = {
  row: BillSuggestion
  payeeSectionRowCount: number
  lookbackMonths: number
  size?: "xs" | "sm"
}

function categoryLabel(category: string | undefined | null): string {
  const text = (category ?? "").trim()
  return text || "—"
}

export function BillSuggestionIgnoreMenu({
  row,
  payeeSectionRowCount,
  lookbackMonths,
  size = "sm",
}: BillSuggestionIgnoreMenuProps) {
  const { data: settings } = useDiscoverSettings()
  const ignorePayeeMutation = useIgnorePayee(lookbackMonths)
  const ignoreCategoryMutation = useIgnoreCategory(lookbackMonths)
  const [pending, setPending] = useState<PendingAction | null>(null)

  const destinationName = row.destination_name?.trim() ?? ""
  const category = row.category?.trim() ?? ""
  const ignoredCategories = settings?.ignored_categories ?? []
  const ignoredPayees = settings?.ignored_payees ?? []

  const categoryIgnored = category
    ? ignoredCategories.some(
        (name) => name.toLowerCase() === category.toLowerCase(),
      )
    : false
  const payeeIgnored = destinationName
    ? ignoredPayees.some(
        (name) => name.toLowerCase() === destinationName.toLowerCase(),
      )
    : false

  const canIgnorePayee = Boolean(destinationName) && !payeeIgnored
  const canIgnoreCategory = Boolean(category) && !categoryIgnored

  if (!canIgnorePayee && !canIgnoreCategory) {
    return null
  }

  const pendingLoading =
    ignorePayeeMutation.isPending || ignoreCategoryMutation.isPending

  async function confirmPending() {
    if (!pending) return
    if (pending.kind === "payee") {
      await ignorePayeeMutation.mutateAsync(row.id)
    } else {
      await ignoreCategoryMutation.mutateAsync(pending.categoryName)
    }
    setPending(null)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size={size}
            disabled={pendingLoading}
            aria-label={`Ignore options for ${row.merchant}`}
          >
            Ignore
            <ChevronDown className="size-3" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!canIgnorePayee}
            onSelect={() => {
              if (!canIgnorePayee) return
              setPending({
                kind: "payee",
                payeeName: destinationName,
                rowCount: payeeSectionRowCount,
              })
            }}
          >
            {canIgnorePayee
              ? "Ignore payee"
              : destinationName
                ? "Ignore payee (already ignored)"
                : "Ignore payee (no Firefly payee)"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canIgnoreCategory}
            onSelect={() => {
              if (!canIgnoreCategory) return
              setPending({ kind: "category", categoryName: category })
            }}
          >
            {canIgnoreCategory
              ? "Ignore category"
              : category
                ? "Ignore category (already ignored)"
                : "Ignore category (no category)"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "payee" ? "Ignore payee?" : "Ignore category?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "payee" ? (
                payeeSectionRowCount > 1 ? (
                  <>
                    Ignore all {payeeSectionRowCount} suggestions for{" "}
                    {pending.payeeName}? Future withdrawals from this payee will
                    not appear in discover.
                  </>
                ) : (
                  <>
                    Ignore payee {pending.payeeName}? Future withdrawals from
                    this payee will not appear in discover.
                  </>
                )
              ) : pending?.kind === "category" ? (
                <>
                  Ignore category &apos;{categoryLabel(pending.categoryName)}
                  &apos;? All withdrawals in this category will be excluded from
                  discover.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingLoading}
              onClick={(event) => {
                event.preventDefault()
                void confirmPending()
              }}
            >
              Ignore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
