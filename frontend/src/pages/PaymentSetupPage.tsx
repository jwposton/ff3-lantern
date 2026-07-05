import { ArrowRight, ScanSearch, Wallet } from "lucide-react"
import { Link, Navigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useRegisteredBills } from "@/hooks/useBillHistory"
import { useHealth } from "@/hooks/useHealth"
import { usePaymentWorksheet } from "@/hooks/usePaymentWorksheet"
import { fetchAvailableBills } from "@/lib/paymentRunApi"

type SetupCardProps = {
  title: string
  description: string
  loading?: boolean
  manageHref: string
}

function SetupCard({ title, description, loading, manageHref }: SetupCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>
          {loading ? <Skeleton className="h-4 w-40" /> : description}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild variant="outline" size="sm">
          <Link to={manageHref}>
            Manage
            <ArrowRight className="ml-2 size-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

export function PaymentSetupPage() {
  const { data: health, isPending: healthPending } = useHealth()
  const { data: registeredData, isPending: registeredPending } =
    useRegisteredBills()
  const { data: availableData, isPending: availablePending } = useQuery({
    queryKey: ["paymentRun", "availableBills"],
    queryFn: fetchAvailableBills,
    select: (result) => result.data,
    staleTime: 1000 * 60 * 2,
  })
  const { data: worksheetData, isPending: worksheetPending } =
    usePaymentWorksheet()

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  const registeredCount = registeredData?.data.length ?? 0
  const availableCount = availableData?.length ?? 0
  const bucketCount = worksheetData?.buckets.length ?? 0
  const groupCount = worksheetData?.bill_groups.length ?? 0
  const cardCount = worksheetData?.credit_cards.length ?? 0
  const excludedCardCount = worksheetData?.excluded_credit_cards.length ?? 0
  const liabilityAccounts =
    worksheetData?.liabilities.filter(
      (row) => row.account_id && !row.registry_id,
    ) ?? []
  const excludedLiabilityCount =
    worksheetData?.excluded_liabilities.length ?? 0

  const countsLoading =
    registeredPending || availablePending || worksheetPending

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Payment setup
          </h1>
          <p className="text-muted-foreground text-sm">
            Overview of bills, buckets, cards, and liabilities — manage each
            domain on its hub page. Monthly planning stays on the worksheet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/manage/payment-run/discover">
              <ScanSearch className="mr-2 size-4" />
              Find bills
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/manage/payment-run">
              <Wallet className="mr-2 size-4" />
              Open worksheet
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SetupCard
          title="Bills"
          loading={countsLoading}
          description={
            availableCount > 0
              ? `${registeredCount} registered · ${availableCount} available to link`
              : `${registeredCount} registered`
          }
          manageHref="/manage/bills"
        />
        <SetupCard
          title="Cash accounts"
          loading={countsLoading}
          description={
            bucketCount === 1
              ? "1 cash account"
              : `${bucketCount} cash accounts`
          }
          manageHref="/manage/payment-run/buckets"
        />
        <SetupCard
          title="Credit cards"
          loading={countsLoading}
          description={
            excludedCardCount > 0
              ? `${cardCount} on worksheet · ${excludedCardCount} excluded`
              : `${cardCount} on worksheet`
          }
          manageHref="/manage/payment-run/cards"
        />
        <SetupCard
          title="Liabilities"
          loading={countsLoading}
          description={
            excludedLiabilityCount > 0
              ? `${liabilityAccounts.length} accounts · ${excludedLiabilityCount} excluded`
              : `${liabilityAccounts.length} liability accounts`
          }
          manageHref="/manage/liabilities"
        />
        <SetupCard
          title="Bill groups"
          loading={countsLoading}
          description={
            groupCount === 1 ? "1 bill group" : `${groupCount} bill groups`
          }
          manageHref="/manage/payment-run/bill-groups"
        />
      </div>

      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Bill-backed rows in Liabilities (e.g. rent) are managed under{" "}
          <Link
            to="/manage/bills"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Bills
          </Link>
          . Loan profiles live on each account&apos;s{" "}
          <span className="font-medium text-foreground">Loan profile</span> page.
        </CardContent>
      </Card>
    </div>
  )
}
