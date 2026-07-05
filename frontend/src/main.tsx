import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { setDemoAnchorDate } from "@/lib/appClock"
import { fetchHealth } from "@/lib/healthApi"
import { router } from "@/routes"

import "./index.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
    },
  },
})

async function bootstrap() {
  try {
    const health = await fetchHealth()
    setDemoAnchorDate(health.demo_anchor_date)
  } catch {
    // Offline or backend not ready — live clock until /health succeeds.
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
