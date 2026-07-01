import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SpendingMomPage } from "./SpendingMomPage"

describe("SpendingMomPage", () => {
  it("renders Spending heading", () => {
    const { getByRole } = render(<SpendingMomPage />)
    expect(getByRole("heading", { level: 1, name: "Spending" })).toBeTruthy()
  })
})

describe("routes", () => {
  it("registers reports/spending/mom to SpendingMomPage", async () => {
    const { router } = await import("@/routes")
    const spendingMomRoute = router.routes[0]?.children?.find(
      (route) => route.path === "reports/spending/mom",
    )
    expect(spendingMomRoute).toBeDefined()
    expect(spendingMomRoute?.path).toBe("reports/spending/mom")
  })
})
