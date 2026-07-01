import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { FireflyTransactionLink } from "./FireflyTransactionLink"

describe("FireflyTransactionLink", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders link with correct href for valid base and numeric journal id", () => {
    render(
      <FireflyTransactionLink
        fireflyBaseUrl="https://ff.example/"
        journalId="123"
      />,
    )

    const link = screen.getByRole("link", { name: /Open in Firefly/i })
    expect(link.getAttribute("href")).toBe(
      "https://ff.example/transactions/show/123",
    )
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  })

  it("renders nothing when base missing or journal id invalid", () => {
    const { container: noBase } = render(
      <FireflyTransactionLink journalId="123" />,
    )
    expect(noBase.textContent).toBe("")

    const { container: badId } = render(
      <FireflyTransactionLink
        fireflyBaseUrl="https://ff.example"
        journalId="abc"
      />,
    )
    expect(badId.textContent).toBe("")
  })
})
