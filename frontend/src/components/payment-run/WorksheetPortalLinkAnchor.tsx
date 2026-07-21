import { ExternalLink } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatPortalHost } from "@/lib/externalLinkUtils"
import type { ResolvedExternalLink } from "@/lib/paymentRunApi"
import { cn } from "@/lib/utils"

type WorksheetPortalLinkAnchorProps = {
  link: ResolvedExternalLink
  rowName?: string
  className?: string
}

export function WorksheetPortalLinkAnchor({
  link,
  rowName,
  className,
}: WorksheetPortalLinkAnchorProps) {
  const hostname = formatPortalHost(link.url)
  const ariaLabel = rowName
    ? `Open ${rowName} portal (${hostname})`
    : `Open ${link.label} portal`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={ariaLabel}
          data-testid={`portal-link-${link.id}`}
          className={cn(
            "text-muted-foreground hover:text-foreground inline-flex rounded p-0.5",
            className,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </TooltipTrigger>
      <TooltipContent side="top">
        {link.label} · {hostname}
      </TooltipContent>
    </Tooltip>
  )
}
