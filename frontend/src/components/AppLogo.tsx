import { useId } from "react"

import { cn } from "@/lib/utils"

interface AppLogoProps {
  className?: string
  size?: number
  /** When true, hides the logo from assistive tech (e.g. inside a labeled control). */
  decorative?: boolean
}

export function AppLogo({ className, size = 20, decorative }: AppLogoProps) {
  const gradId = useId().replace(/:/g, "")

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "FF3 Lantern"}
      aria-hidden={decorative ? true : undefined}
      className={cn("shrink-0", className)}
    >
      <defs>
        <radialGradient
          id={gradId}
          cx="16"
          cy="17"
          r="13"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.9" />
          <stop offset="45%" stopColor="#fbbf24" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="17" r="13" fill={`url(#${gradId})`} />
      <path
        d="M16 5c0 0-6 6.5-6 12a6 6 0 0 0 12 0c0-5.5-6-12-6-12z"
        fill="#ea580c"
      />
      <path
        d="M16 10.5c0 0-3 3.2-3 6a3 3 0 0 0 6 0c0-2.8-3-6-3-6z"
        fill="#fef3c7"
      />
    </svg>
  )
}
