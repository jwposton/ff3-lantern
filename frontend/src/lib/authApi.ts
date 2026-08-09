import { apiFetch } from "@/lib/apiClient"

export type AuthMode = "none" | "local" | "oidc"

export type AuthConfig = {
  auth_mode: AuthMode
  secured: boolean
}

export type AuthMeUser = {
  id: number
  username: string
  display_name: string | null
  role_id: number
}

export type PermissionLevel = "none" | "read" | "write"

export type AuthMe = {
  user: AuthMeUser
  must_change_password: boolean
  permissions: Record<string, PermissionLevel>
}

export class AuthRequestError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = "AuthRequestError"
    this.status = status
    this.detail = detail
  }
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: string }
    if (typeof data.detail === "string") return data.detail
  } catch {
    // ignore parse errors
  }
  return res.statusText || "Request failed"
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await apiFetch("/api/auth/config")
  if (!res.ok) {
    throw new AuthRequestError(res.status, await parseErrorDetail(res))
  }
  return (await res.json()) as AuthConfig
}

export async function fetchAuthMe(): Promise<AuthMe> {
  const res = await apiFetch("/api/auth/me")
  if (!res.ok) {
    throw new AuthRequestError(res.status, await parseErrorDetail(res))
  }
  return (await res.json()) as AuthMe
}

export async function loginLocal(
  username: string,
  password: string,
): Promise<void> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    throw new AuthRequestError(res.status, await parseErrorDetail(res))
  }
}

export async function logout(): Promise<void> {
  const res = await apiFetch("/api/auth/logout", { method: "POST" })
  if (!res.ok) {
    throw new AuthRequestError(res.status, await parseErrorDetail(res))
  }
}

export async function refreshSession(): Promise<void> {
  const res = await apiFetch("/api/auth/refresh", { method: "POST" })
  if (!res.ok) {
    throw new AuthRequestError(res.status, await parseErrorDetail(res))
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await apiFetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })
  if (!res.ok) {
    throw new AuthRequestError(res.status, await parseErrorDetail(res))
  }
}
