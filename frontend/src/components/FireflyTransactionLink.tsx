import { ExternalLink } from "lucide-react"

import { buildFireflyTransactionUrl } from "@/lib/fireflyLinks"

type FireflyTransactionLinkProps = {
  fireflyBaseUrl?: string
  journalId: string
}

export function FireflyTransactionLink({
  fireflyBaseUrl,
  journalId,
}: FireflyTransactionLinkProps) {
  const href = buildFireflyTransactionUrl(fireflyBaseUrl, journalId)
  if (!href) {
    return null
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      Open in Firefly
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
    </a>
  )
}
