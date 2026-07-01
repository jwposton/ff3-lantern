import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"

import { invalidateReportCaches } from "./reportCache"

describe("invalidateReportCaches", () => {
  it("invalidates normalizedTransactions, categorizeMeta, and loanMeta", async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined)

    await invalidateReportCaches(queryClient)

    expect(invalidateSpy).toHaveBeenCalledTimes(3)
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["normalizedTransactions"],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["categorizeMeta"],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["loanMeta"],
    })
  })
})
