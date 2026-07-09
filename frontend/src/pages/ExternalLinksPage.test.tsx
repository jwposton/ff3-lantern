import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { TooltipProvider } from "@/components/ui/tooltip"
import {
  externalLinksQueryKey,
  type ExternalLink,
} from "@/lib/paymentRunApi"

import { ExternalLinksPage } from "./ExternalLinksPage"

const MOCK_LINKS: ExternalLink[] = [
  {
    id: "chase-login",
    label: "Chase login",
    url: "https://chase.com/login",
    dependents: { bills: 2, buckets: 1, total: 3 },
  },
  {
    id: "amex-login",
    label: "Amex login",
    url: "https://americanexpress.com/",
    dependents: {},
  },
]

let testQueryClient: QueryClient

function TestProviders({ children }: { children: ReactNode }) {
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={testQueryClient}>
      <TooltipProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function mockExternalLinksFetch(links: ExternalLink[] = MOCK_LINKS) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"

    if (url.includes("/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          payment_worksheet_enabled: true,
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/external-links") && method === "GET") {
      return new Response(JSON.stringify({ data: links }), { status: 200 })
    }

    if (url.includes("/api/payment-run/external-links") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"))
      return new Response(
        JSON.stringify({
          id: "new-link",
          label: body.label,
          url: body.url,
          dependents: {},
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/external-links/chase-login") && method === "PATCH") {
      const body = JSON.parse(String(init?.body ?? "{}"))
      if (body.url === "http://insecure.example.com") {
        return new Response(
          JSON.stringify({
            detail: [{ msg: "url must use https scheme" }],
          }),
          { status: 422 },
        )
      }
      return new Response(
        JSON.stringify({
          ...MOCK_LINKS[0],
          ...body,
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/external-links/amex-login") && method === "PATCH") {
      const body = JSON.parse(String(init?.body ?? "{}"))
      return new Response(
        JSON.stringify({
          ...MOCK_LINKS[1],
          ...body,
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/external-links/amex-login") && method === "DELETE") {
      return new Response(null, { status: 204 })
    }

    return new Response("not found", { status: 404 })
  })
}

describe("ExternalLinksPage", () => {
  beforeEach(() => {
    testQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders catalog table with hostname subtext", async () => {
    mockExternalLinksFetch()

    render(
      <TestProviders>
        <ExternalLinksPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("external-links-table")).toBeTruthy()
    })

    expect(screen.getByText("Chase login")).toBeTruthy()
    expect(screen.getByText("chase.com")).toBeTruthy()
    expect(screen.getByText("Amex login")).toBeTruthy()
    expect(screen.getByText("americanexpress.com")).toBeTruthy()
  })

  it("creates link via Add link sheet save and POST", async () => {
    const fetchSpy = mockExternalLinksFetch()

    render(
      <TestProviders>
        <ExternalLinksPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Chase login")).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId("external-links-add-button"))

    await waitFor(() => {
      expect(screen.getByTestId("external-link-sheet")).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Wells Fargo" },
    })
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://wellsfargo.com/" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save link" }))

    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find(
        ([requestUrl, init]) =>
          String(requestUrl).includes("/api/payment-run/external-links") &&
          init?.method === "POST",
      )
      expect(postCall).toBeTruthy()
      const body = JSON.parse(String(postCall?.[1]?.body))
      expect(body.label).toBe("Wells Fargo")
      expect(body.url).toBe("https://wellsfargo.com/")
    })
  })

  it("edits link via PATCH", async () => {
    const fetchSpy = mockExternalLinksFetch()

    render(
      <TestProviders>
        <ExternalLinksPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Amex login")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Edit Amex login/i }))

    await waitFor(() => {
      expect(screen.getByLabelText("Label")).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Amex card portal" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save link" }))

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        ([requestUrl, init]) =>
          String(requestUrl).includes("/api/payment-run/external-links/amex-login") &&
          init?.method === "PATCH",
      )
      expect(patchCall).toBeTruthy()
      const body = JSON.parse(String(patchCall?.[1]?.body))
      expect(body.label).toBe("Amex card portal")
    })
  })

  it("deletes unused link after confirm", async () => {
    const fetchSpy = mockExternalLinksFetch()

    render(
      <TestProviders>
        <ExternalLinksPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Amex login")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Edit Amex login/i }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete link" })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Delete link" }))
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }))

    await waitFor(() => {
      const deleteCall = fetchSpy.mock.calls.find(
        ([requestUrl, init]) =>
          String(requestUrl).includes("/api/payment-run/external-links/amex-login") &&
          init?.method === "DELETE",
      )
      expect(deleteCall).toBeTruthy()
    })
  })

  it("disables delete when link has dependents", async () => {
    mockExternalLinksFetch()

    render(
      <TestProviders>
        <ExternalLinksPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Chase login")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Edit Chase login/i }))

    await waitFor(() => {
      expect(screen.getByTestId("external-link-delete-disabled")).toBeTruthy()
    })

    expect(screen.queryByRole("button", { name: "Delete link" })).toBeNull()
  })

  it("surfaces HTTPS validation error inline on 422", async () => {
    mockExternalLinksFetch()

    render(
      <TestProviders>
        <ExternalLinksPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Chase login")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Edit Chase login/i }))

    await waitFor(() => {
      expect(screen.getByLabelText("URL")).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "http://insecure.example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save link" }))

    await waitFor(() => {
      expect(screen.getByText("url must use https scheme")).toBeTruthy()
    })
  })

  it("invalidates externalLinksQueryKey after mutation", async () => {
    mockExternalLinksFetch()

    render(
      <TestProviders>
        <ExternalLinksPage />
      </TestProviders>,
    )

    const invalidateSpy = vi.spyOn(testQueryClient, "invalidateQueries")

    await waitFor(() => {
      expect(screen.getByText("Amex login")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Edit Amex login/i }))

    await waitFor(() => {
      expect(screen.getByLabelText("Label")).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Amex updated" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save link" }))

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: externalLinksQueryKey(),
      })
    })
  })

  it("shows dependents badge and tooltip breakdown", async () => {
    mockExternalLinksFetch()

    render(
      <TestProviders>
        <ExternalLinksPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("3 entities")).toBeTruthy()
    })

    const badge = screen.getAllByTestId("external-link-dependents-badge")[0]
    fireEvent.focus(badge.closest("button") ?? badge)

    await waitFor(() => {
      const tooltip = screen.getByRole("tooltip")
      expect(tooltip.textContent).toContain("2 bills · 1 bucket")
    })
  })

  it("shows used-by hub links in edit sheet", async () => {
    mockExternalLinksFetch()

    render(
      <TestProviders>
        <ExternalLinksPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Chase login")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Edit Chase login/i }))

    await waitFor(() => {
      expect(screen.getByTestId("external-link-sheet")).toBeTruthy()
    })

    const sheet = screen.getByTestId("external-link-sheet")
    const billsLink = within(sheet).getByRole("link", { name: "2 bills" })
    expect(billsLink.getAttribute("href")).toBe("/manage/bills")

    const bucketLink = within(sheet).getByRole("link", { name: "1 bucket" })
    expect(bucketLink.getAttribute("href")).toBe("/manage/payment-run/buckets")
  })
})
