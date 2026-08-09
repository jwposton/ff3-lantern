import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import {
  fetchAuthConfig,
  fetchAuthMe,
  logout as logoutApi,
  refreshSession,
  type AuthConfig,
  type AuthMe,
  type AuthMeUser,
  type AuthMode,
  type PermissionLevel,
} from "@/lib/authApi"

const LEVEL_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
}

type AuthContextValue = {
  authMode: AuthMode
  secured: boolean
  isLoading: boolean
  user: AuthMeUser | null
  permissions: Record<string, PermissionLevel> | null
  mustChangePassword: boolean
  hasPermission: (resource: string, minLevel?: PermissionLevel) => boolean
  logout: () => Promise<void>
  reloadSession: () => Promise<void>
  clearMustChangePassword: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [me, setMe] = useState<AuthMe | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadSession = useCallback(async (secured: boolean) => {
    if (!secured) {
      setMe(null)
      return
    }

    try {
      await refreshSession()
    } catch {
      // Silent refresh failure is expected when logged out.
    }

    try {
      const session = await fetchAuthMe()
      setMe(session)
    } catch {
      setMe(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      setIsLoading(true)
      try {
        const authConfig = await fetchAuthConfig()
        if (cancelled) return
        setConfig(authConfig)
        await loadSession(authConfig.secured)
      } catch {
        if (!cancelled) {
          setConfig({ auth_mode: "none", secured: false })
          setMe(null)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [loadSession])

  const hasPermission = useCallback(
    (resource: string, minLevel: PermissionLevel = "read") => {
      if (!config?.secured || !me) return false
      const level = me.permissions[resource] ?? "none"
      if (level === "none") return false
      return LEVEL_RANK[level] >= LEVEL_RANK[minLevel]
    },
    [config?.secured, me],
  )

  const logout = useCallback(async () => {
    try {
      if (config?.secured) {
        await logoutApi()
      }
    } finally {
      setMe(null)
      window.location.assign("/login")
    }
  }, [config?.secured])

  const reloadSession = useCallback(async () => {
    if (!config?.secured) return
    await loadSession(true)
  }, [config?.secured, loadSession])

  const clearMustChangePassword = useCallback(() => {
    setMe((current) =>
      current ? { ...current, must_change_password: false } : current,
    )
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      authMode: config?.auth_mode ?? "none",
      secured: config?.secured ?? false,
      isLoading,
      user: me?.user ?? null,
      permissions: me?.permissions ?? null,
      mustChangePassword: me?.must_change_password ?? false,
      hasPermission,
      logout,
      reloadSession,
      clearMustChangePassword,
    }),
    [
      config,
      isLoading,
      me,
      hasPermission,
      logout,
      reloadSession,
      clearMustChangePassword,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return ctx
}
