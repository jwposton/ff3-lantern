import { type FormEvent, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { AppLogo } from "@/components/AppLogo"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/context/AuthContext"
import { AuthRequestError, loginLocal } from "@/lib/authApi"
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/product"

function loginErrorMessage(error: unknown): string {
  if (error instanceof AuthRequestError) {
    if (error.status === 401 && error.detail === "Invalid credentials") {
      return "Invalid username or password."
    }
    if (error.status === 429 || error.detail === "Too many login attempts") {
      return "Too many login attempts. Wait a few minutes and try again."
    }
    if (error.status === 404) {
      return "Local sign-in is not enabled on this server."
    }
  }
  return "Could not sign in. Check your connection and try again."
}

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { authMode, secured, isLoading, reloadSession } = useAuth()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const returnTo = searchParams.get("returnTo") || "/"

  async function handleLocalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await loginLocal(username.trim(), password)
      await reloadSession()
      navigate(returnTo, { replace: true })
    } catch (err) {
      setError(loginErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  function handleSsoClick() {
    window.location.assign("/api/auth/oidc/login")
  }

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4 py-12">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (!secured || authMode === "none") {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4 py-12">
        <p className="text-sm text-muted-foreground">
          Authentication is not enabled on this server.
        </p>
      </div>
    )
  }

  const isOidc = authMode === "oidc"

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="flex justify-center">
            <AppLogo size={32} />
          </div>
          <p className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</p>
          <p className="text-sm text-muted-foreground">{PRODUCT_TAGLINE}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              {isOidc
                ? "Sign in with your organization's identity provider."
                : "Enter your Lantern username and password."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isOidc ? (
              <Button
                type="button"
                className="w-full"
                onClick={handleSsoClick}
                disabled={submitting}
              >
                {submitting ? "Signing in…" : "Sign in with SSO"}
              </Button>
            ) : (
              <form className="space-y-4" onSubmit={handleLocalSubmit}>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Username</span>
                  <Input
                    autoComplete="username"
                    placeholder="Username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    aria-invalid={error ? true : undefined}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Password</span>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={error ? true : undefined}
                    required
                  />
                </label>
                {error ? (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                ) : null}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
