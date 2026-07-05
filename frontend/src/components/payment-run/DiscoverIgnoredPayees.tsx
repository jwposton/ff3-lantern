import { X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useDiscoverSettings,
  useUpdateDiscoverSettings,
} from "@/hooks/useDiscoverSettings"
import { cn } from "@/lib/utils"

type DiscoverIgnoredPayeesProps = {
  className?: string
}

export function DiscoverIgnoredPayees({ className }: DiscoverIgnoredPayeesProps) {
  const { data, isPending, isError } = useDiscoverSettings()
  const updateMutation = useUpdateDiscoverSettings()

  const ignored = data?.ignored_payees ?? []

  function removePayee(payeeName: string) {
    updateMutation.mutate({
      ignored_payees: ignored.filter(
        (name) => name.toLowerCase() !== payeeName.toLowerCase(),
      ),
    })
  }

  if (isPending) {
    return (
      <div className={cn("space-y-2", className)}>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-48" />
      </div>
    )
  }

  if (isError) {
    return (
      <p className={cn("text-destructive text-sm", className)}>
        Could not load ignored payee settings.
      </p>
    )
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="space-y-1">
        <p className="text-sm font-medium">Ignored payees</p>
        <p className="text-muted-foreground text-xs">
          Withdrawals to these Firefly payees are skipped. Add payees from the
          Ignore menu on Bill discover rows.
        </p>
      </div>

      {ignored.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Ignored payees">
          {ignored.map((name) => (
            <li key={name}>
              <Badge variant="secondary" className="gap-1 pr-1">
                {name}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-full"
                  aria-label={`Remove ${name} from ignored payees`}
                  disabled={updateMutation.isPending}
                  onClick={() => removePayee(name)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">No payees ignored.</p>
      )}

      {updateMutation.isPending ? (
        <span className="text-muted-foreground text-xs">Saving…</span>
      ) : null}
    </div>
  )
}
