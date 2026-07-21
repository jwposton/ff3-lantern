import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FundingBucketBar } from "./FundingBucketBar"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { FundingBucketRollup } from "@/lib/paymentRunApi"

const baseBucket: FundingBucketRollup = {
  id: "checking",
  label: "Checking",
  sort_order: 0,
  reported_balance: "5000.00",
  user_balance: "5000.00",
  user_balance_override: false,
  planned_outflows: "0.00",
  remaining: "5000.00",
}

function renderFundingBucketBar(buckets: FundingBucketRollup[]) {
  render(
    <TooltipProvider>
      <FundingBucketBar
        buckets={buckets}
        totals={{
          reported_balance: "5000.00",
          user_balance: "5000.00",
          remaining: "5000.00",
        }}
        accountNameById={new Map()}
        onBalanceBlur={vi.fn(async () => {})}
        onResetBalance={vi.fn()}
      />
    </TooltipProvider>,
  )
}

describe("FundingBucketBar portal anchors", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows portal anchor after bucket label when external_link is set", () => {
    renderFundingBucketBar([
      {
        ...baseBucket,
        external_link: {
          id: "bucket-portal",
          label: "Bank Portal",
          url: "https://bank.example.com/login",
        },
      },
    ])

    const portal = screen.getByTestId("portal-link-bucket-portal")
    expect(portal.getAttribute("href")).toBe("https://bank.example.com/login")
    expect(portal.getAttribute("aria-label")).toBe("Open Bank Portal portal")
  })

  it("hides portal anchor when external_link is null", () => {
    renderFundingBucketBar([{ ...baseBucket, external_link: null }])

    expect(screen.queryByTestId(/^portal-link-/)).toBeNull()
  })
})
