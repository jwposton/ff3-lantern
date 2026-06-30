import { ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"
import { openFireflySearch } from "@/lib/fireflySearch"

type DrilldownFireflyLinkProps = {
  fireflyBaseUrl?: string
  filters: string
  children: React.ReactNode
  className?: string
}

export function DrilldownFireflyLink({
  fireflyBaseUrl,
  filters,
  children,
  className,
}: DrilldownFireflyLinkProps) {
  if (!fireflyBaseUrl || !filters) {
    return <span className={className}>{children}</span>
  }

  return (
    <Button
      type="button"
      variant="link"
      className={`h-auto p-0 font-normal text-muted-foreground hover:text-foreground ${className ?? ""}`}
      onClick={() => openFireflySearch(fireflyBaseUrl, filters)}
    >
      {children}
      <ExternalLink className="ml-1 inline h-3 w-3 shrink-0" aria-hidden />
      <span className="sr-only"> — search in Firefly</span>
    </Button>
  )
}
