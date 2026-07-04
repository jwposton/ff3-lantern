import { useMemo, useState } from "react"
import { Link, Navigate } from "react-router-dom"
import { Pencil, Plus } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { BucketSheet } from "@/components/payment-run/BucketSheet"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useHealth } from "@/hooks/useHealth"
import { useLoanMeta } from "@/hooks/useLoans"
import {
  paymentRunQueryKey,
  usePaymentWorksheet,
} from "@/hooks/usePaymentWorksheet"
import { isFundingBucketAsset } from "@/lib/accounts"
import {
  createFundingBucket,
  currentMonthKey,
  deleteFundingBucket,
  fetchFundingBuckets,
  updateFundingBucket,
  type FundingBucket,
  type FundingBucketRollup,
} from "@/lib/paymentRunApi"

export function PaymentBucketsPage() {
  const month = currentMonthKey()
  const queryClient = useQueryClient()
  const { data: health, isPending: healthPending } = useHealth()
  const { data, isPending } = usePaymentWorksheet(month)
  const { data: loanMeta } = useLoanMeta()
  const [bucketSheetOpen, setBucketSheetOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<FundingBucket | null>(
    null,
  )

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
    return map
  }, [loanMeta])

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
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
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
  }

  async function handleDeleteBucket(bucketId: string) {
    await deleteFundingBucket(bucketId)
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
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

  const buckets = data?.buckets ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Cash buckets
          </h1>
          <p className="text-muted-foreground text-sm">
            Link Firefly cash accounts to funding buckets. Set user balances on
            the{" "}
            <Link
              to="/manage/payment-run"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              payment worksheet
            </Link>{" "}
            for this month&apos;s inter-account moves.
          </p>
        </div>
        <Button type="button" onClick={openAddBucket}>
          <Plus className="mr-2 size-4" />
          Add bucket
        </Button>
      </div>

      {isPending || healthPending ? (
        <Skeleton className="h-32 w-full" />
      ) : buckets.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground text-sm">
              No funding buckets yet. Click{" "}
              <span className="font-medium text-foreground">Add bucket</span>{" "}
              to create one.
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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Edit ${bucket.label}`}
                onClick={() => void openEditBucket(bucket)}
              >
                <Pencil className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <BucketSheet
        open={bucketSheetOpen}
        onOpenChange={setBucketSheetOpen}
        bucket={editingBucket}
        assetAccounts={bucketAssetAccounts}
        onSave={handleSaveBucket}
        onDelete={handleDeleteBucket}
      />
    </div>
  )
}
