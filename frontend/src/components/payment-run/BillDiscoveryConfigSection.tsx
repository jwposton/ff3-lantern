import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DiscoverIgnoredCategories } from "@/components/payment-run/DiscoverIgnoredCategories"
import { DiscoverIgnoredPayees } from "@/components/payment-run/DiscoverIgnoredPayees"
import { useDiscoverSettings } from "@/hooks/useDiscoverSettings"

function formatSummary(categoryCount: number, payeeCount: number): string {
  const parts: string[] = []
  parts.push(
    categoryCount === 1
      ? "1 category"
      : `${categoryCount} categories`,
  )
  parts.push(
    payeeCount === 1 ? "1 payee" : `${payeeCount} payees`,
  )
  return `${parts[0]} · ${parts[1]} ignored`
}

export function BillDiscoveryConfigSection() {
  const { data } = useDiscoverSettings()
  const categoryCount = data?.ignored_categories.length ?? 0
  const payeeCount = data?.ignored_payees.length ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Bill discovery config</CardTitle>
        <CardDescription>
          {formatSummary(categoryCount, payeeCount)} — tune what Bill discover
          excludes before you run Find bills. Row-level Ignore actions on the
          discover page add entries here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <DiscoverIgnoredCategories />
        <DiscoverIgnoredPayees />
      </CardContent>
    </Card>
  )
}
