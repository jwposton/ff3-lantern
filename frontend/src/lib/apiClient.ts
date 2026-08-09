export class AuthError extends Error {
  constructor(message = "Not authenticated") {
    super(message)
    this.name = "AuthError"
  }
}

const AUTH_LOGIN_PATH = "/api/auth/login"
const AUTH_REFRESH_PATH = "/api/auth/refresh"

let refreshInFlight: Promise<boolean> | null = null

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.pathname
  return input.url
}

function shouldSkipRefreshRetry(url: string): boolean {
  return url.includes(AUTH_LOGIN_PATH) || url.includes(AUTH_REFRESH_PATH)
}

async function tryRefreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(AUTH_REFRESH_PATH, {
          method: "POST",
          credentials: "include",
        })
        return res.ok
      } catch {
        return false
      } finally {
        refreshInFlight = null
      }
    })()
  }
  return refreshInFlight
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = requestUrl(input)
  const skipRefresh = shouldSkipRefreshRetry(url)

  const doFetch = () =>
    fetch(input, {
      ...init,
      credentials: "include",
    })

  let res = await doFetch()

  if (res.status === 401 && !skipRefresh) {
    const refreshed = await tryRefreshSession()
    if (refreshed) {
      res = await doFetch()
    }
    if (res.status === 401) {
      throw new AuthError()
    }
  }

  return res
}
