import { setDemoAnchorDate } from "@/lib/appClock"

export type HealthResponse = {
  status: string
  firefly_base_url_configured: boolean
  firefly_api_token_configured: boolean
  openrouter_configured: boolean
  sidecar_writable: boolean
  payment_worksheet_enabled: boolean
  demo_anchor_date?: string | null
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/health")
  if (!res.ok) throw new Error(`Failed to fetch health (${res.status})`)
  const data = (await res.json()) as HealthResponse
  setDemoAnchorDate(data.demo_anchor_date)
  return data
}
