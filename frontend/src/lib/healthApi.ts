export type HealthResponse = {
  status: string
  firefly_base_url_configured: boolean
  firefly_api_token_configured: boolean
  openrouter_configured: boolean
  sidecar_writable: boolean
  payment_worksheet_enabled: boolean
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/health")
  if (!res.ok) throw new Error(`Failed to fetch health (${res.status})`)
  return (await res.json()) as HealthResponse
}
