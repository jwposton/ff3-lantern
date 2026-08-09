import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"

export function ForbiddenPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Access denied</h1>
      <p className="max-w-prose text-muted-foreground">
        You don&apos;t have permission to view this page. Contact your
        administrator if you need access.
      </p>
      <Button asChild>
        <Link to="/">Go to Dashboard</Link>
      </Button>
    </div>
  )
}
