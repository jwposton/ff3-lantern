export async function clearReferenceCache(): Promise<void> {
  const res = await fetch("/api/cache/clear", { method: "POST" })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body || `Clear cache failed (${res.status})`)
  }
}
