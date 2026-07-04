import { useMemo, useState } from "react"
import { Link, Navigate } from "react-router-dom"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  BillRegistrationSheet,
  type BillRegistrationEditTarget,
} from "@/components/payment-run/BillRegistrationSheet"
import { BucketSheet } from "@/components/payment-run/BucketSheet"
import { COMPACT_TABLE } from "@/components/payment-run/BillsTable"
import { ManageLiabilitiesSheet } from "@/components/payment-run/ManageLiabilitiesSheet"
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
import { useHealth } from "@/hooks/useHealth"
import { useLoanMeta } from "@/hooks/useLoans"
import { paymentRunQueryKey, usePaymentWorksheet } from "@/hooks/usePaymentWorksheet"
import { isFundingBucketAsset } from "@/lib/accounts"
import {
  createFundingBucket,
  currentMonthKey,
  deleteBillRegistry,
  deleteFundingBucket,
  fetchAvailableBills,
  fetchFundingBuckets,
  putAccountWorksheet,
  registerBill,
  updateBillRegistry,
  updateFundingBucket,
  type BillRow,
  type FundingBucket,
  type FundingBucketRollup,
  type LiabilityRow,
  type RegisterBillPayload,
} from "@/lib/paymentRunApi"

type RegisteredBillRow = {
  registry_id: number
  name: string
  worksheet_section: string
  payment_rail: string
  funding_bucket_key: string | null
  credit_card_account_id: string | null
  amount_mode: string
}

function toRegisteredBillRow(row: BillRow | LiabilityRow): RegisteredBillRow | null {
  if (!row.registry_id) return null
  const worksheetSection =
    "worksheet_section" in row && row.worksheet_section
      ? row.worksheet_section
      : "bills"
  return {
    registry_id: row.registry_id,
    name: row.row_label ?? ("name" in row ? row.name : null) ?? `Bill ${row.registry_id}`,
    worksheet_section: worksheetSection,
    payment_rail: row.payment_rail ?? "bank",
    funding_bucket_key: row.funding_bucket_key ?? null,
    credit_card_account_id: row.credit_card_account_id ?? null,
    amount_mode: row.amount_mode ?? "recurring",
  }
}

function formatRailLabel(rail: string): string {
  return rail === "credit_card" ? "Credit card" : "Bank account"
}

function formatSectionLabel(section: string): string {
  return section === "liabilities" ? "Liabilities" : "Bills"
}

function formatAmountMode(mode: string): string {
  return mode === "intermittent" ? "Intermittent" : "Recurring"
}

export function PaymentSetupPage() {
  const month = currentMonthKey()
  const queryClient = useQueryClient()
  const { data: health, isPending: healthPending } = useHealth()
  const { data, isPending, isError, refetch } = usePaymentWorksheet(month)
  const { data: loanMeta } = useLoanMeta()

  const [bucketSheetOpen, setBucketSheetOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<FundingBucket | null>(null)
  const [billRegistrationOpen, setBillRegistrationOpen] = useState(false)
  const [billInitialMode, setBillInitialMode] = useState<
    "create_new" | "link_existing"
  >("create_new")
  const [linkBillId, setLinkBillId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<BillRegistrationEditTarget | null>(
    null,
  )
  const [manageLiabilitiesOpen, setManageLiabilitiesOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<RegisteredBillRow | null>(null)
  const [removing, setRemoving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data: availableData, isPending: availablePending } = useQuery({
    queryKey: ["paymentRun", "availableBills"],
    queryFn: fetchAvailableBills,
    select: (result) => result.data,
    staleTime: 0,
  })

  const bucketAssetAccounts = useMemo(
    () =>
      (loanMeta?.asset_accounts ?? []).filter((account) =>
        isFundingBucketAsset(account.type, account.role),
      ),
    [loanMeta],
  )

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const account of loanMeta?.asset_accounts ?? []) {
      map.set(account.id, account.name)
    }
    for (const card of data?.credit_cards ?? []) {
      map.set(card.account_id, card.name ?? card.account_id)
    }
    return map
  }, [loanMeta, data?.credit_cards])

  const bucketLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const bucket of data?.buckets ?? []) {
      map.set(bucket.id, bucket.label)
    }
    return map
  }, [data?.buckets])

  const registeredBills = useMemo(() => {
    const rows: RegisteredBillRow[] = []
    for (const bill of data?.bills ?? []) {
      const mapped = toRegisteredBillRow(bill)
      if (mapped) rows.push(mapped)
    }
    for (const liability of data?.liabilities ?? []) {
      const mapped = toRegisteredBillRow(liability)
      if (mapped) rows.push(mapped)
    }
    return rows
  }, [data?.bills, data?.liabilities])

  const includedLiabilities = useMemo(
    () =>
      (data?.liabilities ?? []).filter(
        (row) => row.account_id && !row.registry_id,
      ),
    [data?.liabilities],
  )

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  async function invalidateWorksheet() {
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
    await queryClient.invalidateQueries({ queryKey: ["paymentRun", "availableBills"] })
  }

  async function handleSaveBucket(values: {
    id?: string
    label: string
    sort_order: number
    firefly_account_ids: string[]
  }) {
    if (values.id) {
      await updateFundingBucket(values.id, values)
    } else {
      await createFundingBucket(values)
    }
    await invalidateWorksheet()
  }

  async function handleDeleteBucket(bucketId: string) {
    await deleteFundingBucket(bucketId)
    await invalidateWorksheet()
  }

  function openAddBucket() {
    setEditingBucket(null)
    setBucketSheetOpen(true)
  }

  async function openEditBucket(bucket: FundingBucketRollup) {
    const { data: buckets } = await fetchFundingBuckets()
    const full = buckets.find((row) => row.id === bucket.id) ?? null
    setEditingBucket(full)
    setBucketSheetOpen(true)
  }

  function openRegisterBill(
    mode: "create_new" | "link_existing" = "create_new",
    fireflyBillId?: string,
  ) {
    setEditTarget(null)
    setBillInitialMode(mode)
    setLinkBillId(fireflyBillId ?? null)
    setBillRegistrationOpen(true)
    void queryClient.refetchQueries({ queryKey: ["paymentRun", "availableBills"] })
  }

  function openEditBill(row: RegisteredBillRow) {
    setEditTarget({
      registryId: row.registry_id,
      row_label: row.name,
      worksheet_section: row.worksheet_section,
      payment_rail: row.payment_rail,
      funding_bucket_key: row.funding_bucket_key,
      credit_card_account_id: row.credit_card_account_id,
      amount_mode: row.amount_mode,
    })
    setBillRegistrationOpen(true)
  }

  async function handleBillSubmit(payload: RegisterBillPayload) {
    setActionError(null)
    if (editTarget) {
      await updateBillRegistry(editTarget.registryId, {
        worksheet_section: payload.worksheet_section,
        payment_rail: payload.payment_rail,
        funding_bucket_key: payload.funding_bucket_key,
        credit_card_account_id: payload.credit_card_account_id,
        row_label: payload.name,
        amount_mode: payload.amount_mode,
      })
    } else {
      await registerBill(payload)
    }
    await invalidateWorksheet()
  }

  async function handleConfirmRemove() {
    if (!removeTarget) return
    setRemoving(true)
    setActionError(null)
    try {
      await deleteBillRegistry(removeTarget.registry_id)
      setRemoveTarget(null)
      await invalidateWorksheet()
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Could not remove bill registration. Try again.",
      )
    } finally {
      setRemoving(false)
    }
  }

  async function handleIncludeLiability(accountId: string) {
    await putAccountWorksheet(accountId, month, { included: true })
    await invalidateWorksheet()
  }

  function bucketLabel(bucketKey: string | null): string {
    if (!bucketKey) return "—"
    return bucketLabelById.get(bucketKey) ?? bucketKey
  }

  function cardLabel(cardId: string | null): string {
    if (!cardId) return "—"
    return accountNameById.get(cardId) ?? cardId
  }

  return (
    <div className="space-y-8">
      <div>
        <Button variant="link" size="sm" className="h-auto px-0" asChild>
          <Link to="/manage/payment-run">Back to worksheet</Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payment setup</h1>
        <p className="text-muted-foreground text-sm">
          Register bills and manage worksheet placement. Funding buckets and credit
          cards can still be edited on the worksheet.
        </p>
      </div>

      {actionError ? (
        <p className="text-destructive text-sm">{actionError}</p>
      ) : null}

      {isError ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-destructive text-sm">
              Could not load payment setup. Try again or return to the worksheet.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void refetch()}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : isPending || healthPending ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <section className="space-y-3" data-testid="setup-funding-buckets">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Funding buckets</h2>
              <Button type="button" size="sm" onClick={openAddBucket}>
                <Plus className="mr-2 size-4" />
                Add bucket
              </Button>
            </div>
            {data.buckets.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-center">
                  <p className="text-muted-foreground text-sm">
                    No funding buckets yet. Add one to group cash for bills and cards.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.buckets.map((bucket) => (
                  <Card key={bucket.id}>
                    <CardContent className="flex items-start justify-between gap-2 py-4">
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${bucket.label}`}
                        onClick={() => void openEditBucket(bucket)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3" data-testid="setup-registered-bills">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Registered bills</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openRegisterBill("create_new")}
              >
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
                      <TableHead>Rail</TableHead>
                      <TableHead>Bucket</TableHead>
                      <TableHead>Amount mode</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registeredBills.map((row) => (
                      <TableRow key={row.registry_id}>
                        <TableCell>{row.name}</TableCell>
                        <TableCell>{formatSectionLabel(row.worksheet_section)}</TableCell>
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
                              onClick={() => openEditBill(row)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove ${row.name}`}
                              onClick={() => setRemoveTarget(row)}
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
          </section>

          <section className="space-y-3" data-testid="setup-available-bills">
            <h2 className="text-lg font-semibold">Available to link</h2>
            {availablePending ? (
              <Skeleton className="h-16 w-full" />
            ) : (availableData ?? []).length === 0 ? (
              <Card>
                <CardContent className="py-6">
                  <p className="text-muted-foreground text-sm">
                    No unregistered Firefly bills found. Add bills in Firefly or
                    register a new bill.
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
                      onClick={() => openRegisterBill("link_existing", bill.id)}
                    >
                      Link bill
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3" data-testid="setup-credit-cards">
            <h2 className="text-lg font-semibold">Credit cards</h2>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4 text-sm">
                <span>
                  {data.credit_cards.length}{" "}
                  {data.credit_cards.length === 1 ? "card" : "cards"} on the
                  worksheet
                </span>
                <Button variant="link" size="sm" className="h-auto px-0" asChild>
                  <Link to="/manage/payment-run">Manage on worksheet</Link>
                </Button>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3" data-testid="setup-liabilities">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Liabilities</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setManageLiabilitiesOpen(true)}
              >
                Manage exclusions
              </Button>
            </div>
            <Card>
              <CardContent className="space-y-2 py-4 text-sm">
                {includedLiabilities.length === 0 ? (
                  <p className="text-muted-foreground">
                    No liability accounts on the worksheet. Refresh balances on the
                    worksheet to load loan accounts from Firefly.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {includedLiabilities.map((row) => (
                      <li key={row.account_id}>
                        {row.name ?? row.account_id}
                      </li>
                    ))}
                  </ul>
                )}
                {data.excluded_liabilities.length > 0 ? (
                  <p className="text-muted-foreground text-xs">
                    {data.excluded_liabilities.length} excluded account
                    {data.excluded_liabilities.length === 1 ? "" : "s"}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </section>
        </>
      )}

      <BucketSheet
        open={bucketSheetOpen}
        onOpenChange={setBucketSheetOpen}
        bucket={editingBucket}
        assetAccounts={bucketAssetAccounts}
        onSave={handleSaveBucket}
        onDelete={editingBucket ? handleDeleteBucket : undefined}
      />

      <BillRegistrationSheet
        open={billRegistrationOpen}
        onOpenChange={(open) => {
          setBillRegistrationOpen(open)
          if (!open) setLinkBillId(null)
        }}
        initialMode={billInitialMode}
        initialFireflyBillId={linkBillId}
        editTarget={editTarget}
        creditCards={data?.credit_cards ?? []}
        buckets={data?.buckets ?? []}
        availableBills={availableData ?? []}
        loadingAvailable={availablePending}
        onSubmit={handleBillSubmit}
      />

      <ManageLiabilitiesSheet
        open={manageLiabilitiesOpen}
        onOpenChange={setManageLiabilitiesOpen}
        excludedLiabilities={data?.excluded_liabilities ?? []}
        onInclude={handleIncludeLiability}
      />

      <Sheet
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
      >
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              Remove {removeTarget?.name ?? "bill"} from worksheet?
            </SheetTitle>
            <SheetDescription>
              The Firefly bill and rule are not deleted.
            </SheetDescription>
          </SheetHeader>
          <SheetFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={removing}
              onClick={() => setRemoveTarget(null)}
            >
              Keep on worksheet
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={removing}
              onClick={() => void handleConfirmRemove()}
            >
              {removing ? "Removing…" : "Remove"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
