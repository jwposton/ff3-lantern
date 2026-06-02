import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type HealthResponse = {
  status: string
  firefly_base_url_configured: boolean
  firefly_api_token_configured: boolean
}

type LoadState = "loading" | "ok" | "error"

function App() {
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadHealth() {
      try {
        const response = await fetch("/health")
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const data = (await response.json()) as HealthResponse
        if (!cancelled) {
          setHealth(data)
          setLoadState(data.status === "ok" ? "ok" : "error")
        }
      } catch {
        if (!cancelled) {
          setHealth(null)
          setLoadState("error")
        }
      }
    }

    void loadHealth()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-[480px] space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-[32px] font-bold leading-[1.2] tracking-tight">FF3Analytics</h1>
          <p className="text-base text-muted-foreground">
            Foundation stack smoke test
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Backend health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadState === "loading" && (
              <p className="text-sm text-muted-foreground">Checking backend…</p>
            )}
            {loadState === "ok" && (
              <Badge className="border-transparent bg-green-600 text-white hover:bg-green-600/90">
                Backend healthy
              </Badge>
            )}
            {loadState === "error" && (
              <Badge variant="destructive">
                Backend unreachable — check Docker and proxy
              </Badge>
            )}
            {health && (
              <div className="space-y-1 text-left text-xs text-muted-foreground">
                <p>
                  firefly_base_url_configured:{" "}
                  {String(health.firefly_base_url_configured)}
                </p>
                <p>
                  firefly_api_token_configured:{" "}
                  {String(health.firefly_api_token_configured)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

export default App
