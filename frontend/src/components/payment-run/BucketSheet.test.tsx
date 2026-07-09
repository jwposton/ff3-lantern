import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BucketSheet } from "./BucketSheet"
import type { FundingBucket } from "@/lib/paymentRunApi"

vi.mock("@/lib/paymentRunApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paymentRunApi")>()
  return {
    ...actual,
    fetchExternalLinks: vi.fn(),
  }
})

import { fetchExternalLinks } from "@/lib/paymentRunApi"

function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const EDITING_BUCKET: FundingBucket = {
  id: "checking",
  label: "Checking",
  sort_order: 0,
  firefly_account_ids: ["acct-1"],
  external_link_id: null,
}

const BASE_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  bucket: EDITING_BUCKET,
  assetAccounts: [{ id: "acct-1", name: "Main Checking", type: "asset", role: null }],
  onSave: vi.fn().mockResolvedValue(undefined),
}

describe("BucketSheet", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.mocked(fetchExternalLinks).mockResolvedValue({
      data: [
        {
          id: "chase-login",
          label: "Chase",
          url: "https://chase.com",
          dependents: { total: 0 },
        },
      ],
    })
  })

  it("renders external link select when catalog has links", async () => {
    render(
      <TestProviders>
        <BucketSheet {...BASE_PROPS} />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("external-link-select")).toBeTruthy()
    })
  })

  it("passes external_link_id through onSave", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <TestProviders>
        <BucketSheet {...BASE_PROPS} onSave={onSave} />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("external-link-select")).toBeTruthy()
    })

    fireEvent.change(screen.getByTestId("external-link-select"), {
      target: { value: "chase-login" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          external_link_id: "chase-login",
        }),
      )
    })
  })
})
