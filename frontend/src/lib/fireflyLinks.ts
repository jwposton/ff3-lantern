/**
 * Build Firefly III transaction show URL from API-provided base only.
 * Returns null when base or journal id is invalid.
 */
export function buildFireflyTransactionUrl(
  fireflyBaseUrl: string | undefined | null,
  journalId: string | undefined | null,
): string | null {
  if (fireflyBaseUrl == null || fireflyBaseUrl.trim() === "") {
    return null
  }

  if (journalId == null || journalId.trim() === "") {
    return null
  }

  const id = journalId.trim()
  if (!/^\d+$/.test(id)) {
    return null
  }

  const base = fireflyBaseUrl.replace(/\/+$/, "")
  return `${base}/transactions/show/${id}`
}
