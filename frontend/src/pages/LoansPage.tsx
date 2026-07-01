import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLoans } from "@/hooks/useLoans"

export function LoansPage() {
  const { data, isPending, isError } = useLoans()
  const rows = data?.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Loans</h1>
          <p className="text-muted-foreground text-sm">
            Configure loan profiles on liability accounts
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/manage/loans/queue">Review splits</Link>
        </Button>
      </div>

      {isPending && <Skeleton className="h-32 w-full" />}
      {isError && (
        <p className="text-destructive text-sm">Failed to load loan accounts.</p>
      )}

      {!isPending && !isError && rows.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground space-y-2 py-8 text-sm">
            <p>No liability accounts found in Firefly.</p>
            <p>
              Loan profiles attach to Firefly <strong>liability</strong> accounts
              (mortgage, auto loan, etc.). Create or reclassify the account in
              Firefly, then refresh this page.
            </p>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.account_id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="space-y-1">
                  <p className="font-medium">{row.name}</p>
                  <Badge variant={row.configured ? "default" : "secondary"}>
                    {row.configured ? "Configured" : "Not configured"}
                  </Badge>
                  {row.enabled && (
                    <Badge className="ml-2" variant="outline">
                      Enabled
                    </Badge>
                  )}
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/manage/loans/${row.account_id}`}>Edit</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
