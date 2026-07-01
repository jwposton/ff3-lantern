import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"

import { invalidateReportCaches } from "./reportCache"

describe("invalidateReportCaches", () => {
  it("invalidates normalizedTransactions query prefix", async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined)

    await invalidateReportCaches(queryClient)

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["normalizedTransactions"],
    })
  })
})
