import { formatAppVersion } from "@/lib/appVersion"
import { cn } from "@/lib/utils"

interface AppVersionBadgeProps {
  className?: string
}

export function AppVersionBadge({ className }: AppVersionBadgeProps) {
  const label = formatAppVersion()

  return (
    <span
      title={`FF3Analytics ${label}`}
      className={cn(
        "select-none tabular-nums tracking-wide text-muted-foreground/60",
        className,
      )}
    >
      {label}
    </span>
  )
}
