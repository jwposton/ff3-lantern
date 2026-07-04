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

/**
 * Build Firefly III account show URL from API-provided base only.
 * Returns null when base or account id is invalid.
 */
export function buildFireflyAccountUrl(
  fireflyBaseUrl: string | undefined | null,
  accountId: string | undefined | null,
): string | null {
  if (fireflyBaseUrl == null || fireflyBaseUrl.trim() === "") {
    return null
  }

  if (accountId == null || accountId.trim() === "") {
    return null
  }

  const id = accountId.trim()
  if (!/^\d+$/.test(id)) {
    return null
  }

  const base = fireflyBaseUrl.replace(/\/+$/, "")
  return `${base}/accounts/show/${id}`
}

/**
 * Build Firefly III bill show URL from API-provided base only.
 * Returns null when base or bill id is invalid.
 */
export function buildFireflyBillUrl(
  fireflyBaseUrl: string | undefined | null,
  billId: string | undefined | null,
): string | null {
  if (fireflyBaseUrl == null || fireflyBaseUrl.trim() === "") {
    return null
  }

  if (billId == null || billId.trim() === "") {
    return null
  }

  const id = billId.trim()
  if (!/^\d+$/.test(id)) {
    return null
  }

  const base = fireflyBaseUrl.replace(/\/+$/, "")
  return `${base}/bills/show/${id}`
}
