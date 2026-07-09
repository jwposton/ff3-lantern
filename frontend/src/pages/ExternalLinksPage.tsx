import { Navigate } from "react-router-dom"

import { useHealth } from "@/hooks/useHealth"

export function ExternalLinksPage() {
  const { data: health, isPending: healthPending } = useHealth()

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">External links</h1>
    </div>
  )
}
