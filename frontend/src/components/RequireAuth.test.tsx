import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"

import { AuthProvider } from "@/context/AuthContext"
import type { AuthMe, PermissionLevel } from "@/lib/authApi"

import { RequireAuth, RequirePermission } from "./RequireAuth"

function buildViewerPermissions(): Record<string, PermissionLevel> {
  return {
    dashboard: "read",
    reports: "read",
    transactions: "read",
    payment_worksheet: "read",
    bill_discover: "read",
    bills: "read",
    liabilities: "read",
    categorize: "none",
    loans: "none",
    payment_setup: "none",
    admin: "none",
    ops_cache: "none",
  }
}

function buildViewerMe(): AuthMe {
  return {
    user: { id: 2, username: "viewer", display_name: "Viewer", role_id: 2 },
    must_change_password: false,
    permissions: buildViewerPermissions(),
  }
}

function mockAuthFetch({
  secured = false,
  me = null,
}: {
  secured?: boolean
  me?: AuthMe | null
} = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes("/api/auth/config")) {
      return new Response(
        JSON.stringify({
          auth_mode: secured ? "local" : "none",
          secured,
        }),
        { status: 200 },
      )
    }
    if (url.includes("/api/auth/refresh")) {
      if (me) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: "Not authenticated" }), {
        status: 401,
      })
    }
    if (url.includes("/api/auth/me")) {
      if (me) {
        return new Response(JSON.stringify(me), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: "Not authenticated" }), {
        status: 401,
      })
    }
    return new Response("not found", { status: 404 })
  })
}

function LoginCapture() {
  const location = useLocation()
  return <div data-testid="login-search">{location.search}</div>
}

function renderGuardedRoute(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginCapture />} />
            <Route
              path="/manage/categorize"
              element={
                <RequireAuth>
                  <RequirePermission resource="categorize">
                    <div>Categorize content</div>
                  </RequirePermission>
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("RequireAuth", () => {
  it("redirects to login with returnTo when secured and not authenticated", async () => {
    mockAuthFetch({ secured: true, me: null })

    renderGuardedRoute("/manage/categorize?foo=bar")

    await waitFor(() => {
      expect(screen.getByTestId("login-search")).toBeTruthy()
    })
    expect(screen.getByTestId("login-search").textContent).toContain(
      "returnTo=%2Fmanage%2Fcategorize%3Ffoo%3Dbar",
    )
  })

  it("shows Access denied for viewer on categorize route", async () => {
    mockAuthFetch({ secured: true, me: buildViewerMe() })

    renderGuardedRoute("/manage/categorize")

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Access denied" }),
      ).toBeTruthy()
    })
    expect(screen.queryByText("Categorize content")).toBeNull()
  })
})
