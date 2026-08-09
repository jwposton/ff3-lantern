import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"

import { useAuth } from "@/context/AuthContext"
import { ForbiddenPage } from "@/pages/ForbiddenPage"

function buildReturnTo(pathname: string, search: string): string {
  return encodeURIComponent(pathname + search)
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { secured, isLoading, user, mustChangePassword } = useAuth()
  const location = useLocation()

  if (!secured) {
    return children
  }

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const returnTo = buildReturnTo(location.pathname, location.search)

  if (!user) {
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />
  }

  if (mustChangePassword) {
    return <Navigate to={`/change-password?returnTo=${returnTo}`} replace />
  }

  return children
}

type RequirePermissionProps = {
  resource: string
  children: ReactNode
}

export function RequirePermission({ resource, children }: RequirePermissionProps) {
  const { secured, hasPermission } = useAuth()

  if (!secured) {
    return children
  }

  if (!hasPermission(resource)) {
    return <ForbiddenPage />
  }

  return children
}
