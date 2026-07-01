declare const __APP_VERSION__: string

/** Semver from frontend/package.json, injected at build time. */
export const APP_VERSION = __APP_VERSION__

export function formatAppVersion(version = APP_VERSION): string {
  return version.startsWith("v") ? version : `v${version}`
}
