import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { registeredBillsQueryKey } from "@/hooks/useBillHistory"
import { paymentRunQueryKey } from "@/hooks/usePaymentWorksheet"
import {
  billGroupsQueryKey,
  currentMonthKey,
  type BillGroup,
} from "@/lib/paymentRunApi"

import { BillGroupsPage } from "./BillGroupsPage"

const MOCK_GROUPS: BillGroup[] = [
  {
    id: "utilities",
    label: "Utilities",
    sort_order: 1,
    member_count: 2,
    visible_count: 2,
    members: [
      { registry_id: 1, row_label: "Electric", show_in_group: true },
      { registry_id: 2, row_label: "Water", show_in_group: true },
    ],
  },
]

let testQueryClient: QueryClient

function TestProviders({ children }: { children: ReactNode }) {
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={testQueryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

function mockBillGroupsFetch() {
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

    if (url.includes("/api/payment-run/bill-groups") && method === "GET") {
      return new Response(JSON.stringify({ data: MOCK_GROUPS }), { status: 200 })
    }

    if (url.includes("/api/payment-run/bill-groups") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"))
      return new Response(
        JSON.stringify({
          id: "new-group",
          label: body.label,
          sort_order: body.sort_order ?? 0,
          member_count: 0,
          visible_count: 0,
          members: [],
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/bill-groups/utilities") && method === "PATCH") {
      const body = JSON.parse(String(init?.body ?? "{}"))
      return new Response(
        JSON.stringify({
          ...MOCK_GROUPS[0],
          ...body,
        }),
        { status: 200 },
      )
    }

    if (url.includes("/api/payment-run/bill-groups/utilities") && method === "DELETE") {
      return new Response(null, { status: 204 })
    }

    if (url.includes("/api/payment-run/bills") && !url.includes("history")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              registry_id: 1,
              row_label: "Electric",
              firefly_bill_id: "bill-1",
              worksheet_section: "bills",
              payment_rail: "bank",
              amount_mode: "recurring",
            },
            {
              registry_id: 2,
              row_label: "Water",
              firefly_bill_id: "bill-2",
              worksheet_section: "bills",
              payment_rail: "bank",
              amount_mode: "recurring",
            },
            {
              registry_id: 3,
              row_label: "Mortgage",
              firefly_bill_id: "bill-3",
              worksheet_section: "liabilities",
              payment_rail: "bank",
              amount_mode: "recurring",
            },
          ],
        }),
        { status: 200 },
      )
    }

    return new Response("not found", { status: 404 })
  })
}

describe("BillGroupsPage", () => {
  beforeEach(() => {
    testQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders group list from GET /api/payment-run/bill-groups", async () => {
    mockBillGroupsFetch()

    render(
      <TestProviders>
        <BillGroupsPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Utilities")).toBeTruthy()
    })
  })

  it("opens add sheet and POSTs new group on save", async () => {
    const fetchSpy = mockBillGroupsFetch()

    render(
      <TestProviders>
        <BillGroupsPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Utilities")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Add group/i }))

    await waitFor(() => {
      expect(screen.getByLabelText("Label")).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Subscriptions" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/payment-run/bill-groups") &&
          init?.method === "POST",
      )
      expect(postCall).toBeTruthy()
      const body = JSON.parse(String(postCall?.[1]?.body))
      expect(body.label).toBe("Subscriptions")
    })
  })

  it("opens edit sheet with member checklist prefilled", async () => {
    mockBillGroupsFetch()

    render(
      <TestProviders>
        <BillGroupsPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Utilities")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Edit Utilities/i }))

    await waitFor(() => {
      const electricCheckbox = screen.getByRole("checkbox", {
        name: /Electric/i,
      }) as HTMLInputElement
      expect(electricCheckbox.checked).toBe(true)
    })
  })

  it("PATCHes sort_order when reorder field changed and saved", async () => {
    const fetchSpy = mockBillGroupsFetch()

    render(
      <TestProviders>
        <BillGroupsPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Utilities")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Edit Utilities/i }))

    await waitFor(() => {
      expect(screen.getByLabelText("Sort order")).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText("Sort order"), {
      target: { value: "5" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/payment-run/bill-groups/utilities") &&
          init?.method === "PATCH",
      )
      expect(patchCall).toBeTruthy()
      const body = JSON.parse(String(patchCall?.[1]?.body))
      expect(body.sort_order).toBe(5)
    })
  })

  it("confirms delete and calls DELETE /api/payment-run/bill-groups/{id}", async () => {
    const fetchSpy = mockBillGroupsFetch()

    render(
      <TestProviders>
        <BillGroupsPage />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Utilities")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Edit Utilities/i }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }))

    await waitFor(() => {
      const deleteCall = fetchSpy.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/payment-run/bill-groups/utilities") &&
          init?.method === "DELETE",
      )
      expect(deleteCall).toBeTruthy()
    })
  })

  it("invalidates paymentRun, billGroups, and registeredBills queries after save", async () => {
    mockBillGroupsFetch()

    render(
      <TestProviders>
        <BillGroupsPage />
      </TestProviders>,
    )

    const invalidateSpy = vi.spyOn(testQueryClient, "invalidateQueries")

    await waitFor(() => {
      expect(screen.getByText("Utilities")).toBeTruthy()
    })

    fireEvent.click(screen.getByRole("button", { name: /Edit Utilities/i }))

    await waitFor(() => {
      expect(screen.getByLabelText("Sort order")).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText("Sort order"), {
      target: { value: "2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    const month = currentMonthKey()

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: paymentRunQueryKey(month),
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: billGroupsQueryKey(),
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: registeredBillsQueryKey(),
      })
    })
  })
})
