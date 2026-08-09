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
import { AuthRequestError, changePassword } from "@/lib/authApi"
import { PRODUCT_NAME } from "@/lib/product"

function changePasswordErrorMessage(error: unknown): string {
  if (error instanceof AuthRequestError) {
    if (error.status === 401 && error.detail === "Invalid credentials") {
      return "Current password is incorrect."
    }
    if (error.status === 422) {
      return error.detail
    }
  }
  return "Could not update password. Try again."
}

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { secured, isLoading, clearMustChangePassword } = useAuth()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const returnTo = searchParams.get("returnTo") || "/"

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.")
      return
    }

    setSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword)
      clearMustChangePassword()
      navigate(returnTo, { replace: true })
    } catch (err) {
      setError(changePasswordErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4 py-12">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (!secured) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4 py-12">
        <p className="text-sm text-muted-foreground">
          Authentication is not enabled on this server.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="flex justify-center">
            <AppLogo size={32} />
          </div>
          <p className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              You must set a new password before using Lantern.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Current password
                </span>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  aria-invalid={error ? true : undefined}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  New password
                </span>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  aria-invalid={error ? true : undefined}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Confirm new password
                </span>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
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
                {submitting ? "Saving…" : "Change password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
