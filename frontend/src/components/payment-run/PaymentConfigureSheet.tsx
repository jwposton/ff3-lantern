import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { COMPACT_TABLE } from "@/components/payment-run/BillsTable"
import {
  formatAmountMode,
  formatRailLabel,
  formatSectionLabel,
  toRegisteredBillRow,
  type RegisteredBillRow,
} from "@/components/payment-run/paymentConfigureUtils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useLoans } from "@/hooks/useLoans"
import { fetchAvailableBills } from "@/lib/paymentRunApi"
import type {
  BillRow,
  CreditCardRow,
  ExcludedCreditCard,
  ExcludedLiability,
  FundingBucketRollup,
  LiabilityRow,
} from "@/lib/paymentRunApi"

export type ConfigureSection =
  | "buckets"
  | "bills"
  | "credit-cards"
  | "loans-liabilities"

type PaymentConfigureSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSection?: ConfigureSection
  buckets: FundingBucketRollup[]
  creditCards: CreditCardRow[]
  bills: BillRow[]
  liabilities: LiabilityRow[]
  excludedCreditCards: ExcludedCreditCard[]
  excludedLiabilities: ExcludedLiability[]
  accountNameById: Map<string, string>
  onRegisterBill: () => void
  onEditBill: (row: RegisteredBillRow) => void
  onRemoveBill: (row: RegisteredBillRow) => void
  onLinkBill: (fireflyBillId: string) => void
  onEditCard: (row: CreditCardRow) => void
  onEditLiabilityAccount: (row: LiabilityRow) => void
  onManageExcludedCards: () => void
  onManageExcludedLiabilities: () => void
}

const SECTIONS: { id: ConfigureSection; label: string }[] = [
  { id: "buckets", label: "Cash buckets" },
  { id: "bills", label: "Bills" },
  { id: "credit-cards", label: "Credit cards" },
  { id: "loans-liabilities", label: "Loans & liabilities" },
]

export function PaymentConfigureSheet({
  open,
  onOpenChange,
  initialSection = "bills",
  buckets,
  creditCards,
  bills,
  liabilities,
  excludedCreditCards,
  excludedLiabilities,
  accountNameById,
  onRegisterBill,
  onEditBill,
  onRemoveBill,
  onLinkBill,
  onEditCard,
  onEditLiabilityAccount,
  onManageExcludedCards,
  onManageExcludedLiabilities,
}: PaymentConfigureSheetProps) {
  const [section, setSection] = useState<ConfigureSection>(initialSection)

  const { data: availableData, isPending: availablePending } = useQuery({
    queryKey: ["paymentRun", "availableBills"],
    queryFn: fetchAvailableBills,
    select: (result) => result.data,
    enabled: open,
    staleTime: 0,
  })

  const { data: loansData, isPending: loansPending } = useLoans()

  const registeredBills = useMemo(() => {
    const rows: RegisteredBillRow[] = []
    for (const bill of bills) {
      const mapped = toRegisteredBillRow(bill)
      if (mapped) rows.push(mapped)
    }
    for (const liability of liabilities) {
      const mapped = toRegisteredBillRow(liability)
      if (mapped) rows.push(mapped)
    }
    return rows
  }, [bills, liabilities])

  const liabilityAccounts = useMemo(
    () =>
      liabilities.filter(
        (row) => row.account_id && !row.registry_id,
      ),
    [liabilities],
  )

  const loanByAccountId = useMemo(() => {
    const map = new Map<
      string,
      { configured: boolean; expectedAmount: string | null }
    >()
    for (const loan of loansData?.data ?? []) {
      map.set(loan.account_id, {
        configured: loan.configured,
        expectedAmount: loan.profile?.match.expected_amount ?? null,
      })
    }
    return map
  }, [loansData])

  function bucketLabel(bucketKey: string | null): string {
    if (!bucketKey) return "—"
    return buckets.find((bucket) => bucket.id === bucketKey)?.label ?? bucketKey
  }

  function cardLabel(cardId: string | null): string {
    if (!cardId) return "—"
    return accountNameById.get(cardId) ?? cardId
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setSection(initialSection)
        onOpenChange(nextOpen)
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Configure worksheet</SheetTitle>
          <SheetDescription>
            Structural setup for buckets, bills, cards, and loan accounts. Monthly
            planning stays on the worksheet.
          </SheetDescription>
        </SheetHeader>

        <div
          className="flex flex-wrap gap-2 px-4"
          role="group"
          aria-label="Configuration section"
        >
          {SECTIONS.map(({ id, label }) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={section === id ? "default" : "outline"}
              aria-pressed={section === id}
              onClick={() => setSection(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {section === "buckets" ? (
            <section className="space-y-3" data-testid="configure-buckets">
              <p className="text-muted-foreground text-sm">
                Add and edit funding buckets in the sticky bar at the top of the
                payment worksheet. Use bucket user balances there for this
                month&apos;s inter-account moves.
              </p>
              {buckets.length === 0 ? (
                <Card>
                  <CardContent className="py-6 text-center">
                    <p className="text-muted-foreground text-sm">
                      No funding buckets yet. Close this panel and use{" "}
                      <span className="font-medium">Add bucket</span> on the
                      worksheet.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <ul className="divide-y rounded-md border">
                  {buckets.map((bucket) => (
                    <li
                      key={bucket.id}
                      className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-medium">{bucket.label}</p>
                        <p className="text-muted-foreground text-xs">
                          {bucket.firefly_account_ids?.length
                            ? bucket.firefly_account_ids
                                .map((id) => accountNameById.get(id) ?? id)
                                .join(", ")
                            : "No accounts linked"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {section === "bills" ? (
            <section className="space-y-4" data-testid="configure-bills">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Registered bills</h3>
                <Button type="button" size="sm" onClick={onRegisterBill}>
                  <Plus className="mr-2 size-4" />
                  Register bill
                </Button>
              </div>
              {registeredBills.length === 0 ? (
                <Card>
                  <CardContent className="py-6 text-center">
                    <p className="text-muted-foreground text-sm">
                      No bills registered on this worksheet yet.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="rounded-md border">
                  <Table className={COMPACT_TABLE}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Section</TableHead>
                        <TableHead>Pmt Src</TableHead>
                        <TableHead>Bucket</TableHead>
                        <TableHead>Amount mode</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {registeredBills.map((row) => (
                        <TableRow key={row.registry_id}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>
                            {formatSectionLabel(row.worksheet_section)}
                          </TableCell>
                          <TableCell>{formatRailLabel(row.payment_rail)}</TableCell>
                          <TableCell>
                            {row.payment_rail === "credit_card"
                              ? cardLabel(row.credit_card_account_id)
                              : bucketLabel(row.funding_bucket_key)}
                          </TableCell>
                          <TableCell>{formatAmountMode(row.amount_mode)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit ${row.name}`}
                                onClick={() => onEditBill(row)}
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${row.name}`}
                                onClick={() => onRemoveBill(row)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Available to link</h3>
                {availablePending ? (
                  <Skeleton className="h-16 w-full" />
                ) : (availableData ?? []).length === 0 ? (
                  <Card>
                    <CardContent className="py-6">
                      <p className="text-muted-foreground text-sm">
                        No unregistered Firefly bills found. Add bills in Firefly
                        or register a new bill.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {(availableData ?? []).map((bill) => (
                      <li
                        key={bill.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                      >
                        <span>{bill.name ?? bill.id}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onLinkBill(bill.id)}
                        >
                          Link bill
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : null}

          {section === "credit-cards" ? (
            <section className="space-y-4" data-testid="configure-credit-cards">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-sm">
                  {creditCards.length}{" "}
                  {creditCards.length === 1 ? "card" : "cards"} on the worksheet.
                  Edit bucket, limits, and defaults from each row.
                </p>
                {excludedCreditCards.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onManageExcludedCards}
                  >
                    Restore excluded ({excludedCreditCards.length})
                  </Button>
                ) : null}
              </div>
              {creditCards.length === 0 ? (
                <Card>
                  <CardContent className="py-6">
                    <p className="text-muted-foreground text-sm">
                      Credit cards appear after you refresh balances on the
                      worksheet.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <ul className="divide-y rounded-md border">
                  {creditCards.map((row) => (
                    <li
                      key={row.account_id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-medium">{row.name ?? row.account_id}</p>
                        <p className="text-muted-foreground text-xs">
                          {bucketLabel(row.funding_bucket_key)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onEditCard(row)}
                      >
                        Edit
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {section === "loans-liabilities" ? (
            <section className="space-y-4" data-testid="configure-loans-liabilities">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-sm">
                  Firefly liability accounts on the worksheet. Loan profiles drive
                  auto-draft planned amounts and payment splits.
                </p>
                {excludedLiabilities.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onManageExcludedLiabilities}
                  >
                    Restore excluded ({excludedLiabilities.length})
                  </Button>
                ) : null}
              </div>
              {loansPending ? (
                <Skeleton className="h-24 w-full" />
              ) : liabilityAccounts.length === 0 ? (
                <Card>
                  <CardContent className="py-6">
                    <p className="text-muted-foreground text-sm">
                      No liability accounts on the worksheet. Refresh balances on
                      the worksheet to load loan accounts from Firefly.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <ul className="divide-y rounded-md border">
                  {liabilityAccounts.map((row) => {
                    const accountId = row.account_id!
                    const loan = loanByAccountId.get(accountId)
                    const configured = loan?.configured ?? false
                    return (
                      <li
                        key={accountId}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                      >
                        <div className="space-y-1">
                          <p className="font-medium">
                            {row.name ?? accountId}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={configured ? "default" : "secondary"}
                            >
                              {configured ? "Loan configured" : "Not configured"}
                            </Badge>
                            <span className="text-muted-foreground text-xs">
                              {bucketLabel(row.funding_bucket_key)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            asChild
                            size="sm"
                            variant="outline"
                          >
                            <Link to={`/manage/loans/${accountId}`}>
                              Loan profile
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onEditLiabilityAccount(row)}
                          >
                            Worksheet
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              <p className="text-muted-foreground text-xs">
                Bill-backed rows in Liabilities (e.g. rent) are managed under
                Bills.
              </p>
            </section>
          ) : null}
        </div>

        <SheetFooter className="border-t pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
