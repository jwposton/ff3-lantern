/**
 * Noun Project: Sankey Chart by Kirby Wu (CC BY 3.0)
 * https://thenounproject.com/icon/sankey-chart-646298/
 */
import type { LucideProps } from "lucide-react"
import { forwardRef } from "react"

import { cn } from "@/lib/utils"

export const SankeyChartIcon = forwardRef<SVGSVGElement, LucideProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 78"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      className={cn("shrink-0", className)}
      {...props}
    >
      <path d="m5 40.8v-18.7c29.7 0 60.3-17.1 90-17.1v18.7c-29.7 0-60.3 17.1-90 17.1z" />
      <path d="m5 59.2c29.7 0 60.3 17.1 90 17.1v18.7c-29.7 0-60.3-17.1-90-17.1z" />
      <path d="m5 59.2v-18.4c29.7 0 60.3 0 90 0v18.4c-29.7 0-60.3 0-90 0z" />
    </svg>
  ),
)
SankeyChartIcon.displayName = "SankeyChartIcon"
