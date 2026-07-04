/** Normalize Firefly account type (API raw or OMNI string). */
export function normalizeAccountType(
  type: string | null | undefined,
): string | null {
  if (type == null || type === "") return null
  if (type.toLowerCase() === "asset") return "Asset account"
  return type
}

/** Normalize Firefly account_role (API raw or OMNI string). */
export function normalizeAccountRole(
  role: string | null | undefined,
): string | null {
  if (role == null || role === "") return null
  const key = role.replace(/_/g, "").toLowerCase()
  if (key === "creditcard" || key === "ccasset") return "Credit card"
  if (key === "defaultasset") return "Default account"
  if (key === "savings") return "Savings"
  // Backend used to fall back to account type "asset" as role — not a real role
  if (key === "asset") return null
  return role
}

export function isBankAccount(
  type: string | null,
  role: string | null,
): boolean {
  if (normalizeAccountType(type) !== "Asset account") return false
  const normalizedRole = normalizeAccountRole(role)
  if (normalizedRole === "Credit card") return false
  // Cash-flow / KPI: unspecified asset role treated as bank
  if (normalizedRole === null) return true
  return normalizedRole === "Default account" || normalizedRole === "Savings"
}

export function isCreditCard(
  type: string | null,
  role: string | null,
): boolean {
  return (
    normalizeAccountType(type) === "Asset account" &&
    normalizeAccountRole(role) === "Credit card"
  )
}

/** Asset accounts that may fund a payment worksheet bucket (excludes credit cards). */
export function isFundingBucketAsset(
  type: string | null | undefined,
  role: string | null | undefined,
): boolean {
  return (
    normalizeAccountType(type ?? null) === "Asset account" &&
    !isCreditCard(type ?? null, role ?? null)
  )
}

/** Strict bank check for Spending Sankey type layer (FireflyReports defaultAsset only). */
export function isSpendingBankAccount(
  type: string | null,
  role: string | null,
): boolean {
  if (normalizeAccountType(type) !== "Asset account") return false
  const normalizedRole = normalizeAccountRole(role)
  return normalizedRole === "Default account" || normalizedRole === "Savings"
}
