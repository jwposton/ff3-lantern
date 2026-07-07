import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"

import { DateRangeProvider } from "@/context/DateRangeContext"
import { SidebarProvider } from "@/components/ui/sidebar"
import { useManageQueueCounts } from "@/hooks/useManageQueueCounts"

import { AppSidebar } from "./AppSidebar"

const RANGE = { start: "2024-06-01", end: "2024-06-30" }

function TestProviders({
  children,
  initialEntries = [`/?start=${RANGE.start}&end=${RANGE.end}`],
  defaultOpen = true,
}: {
  children: ReactNode
  initialEntries?: string[]
  defaultOpen?: boolean
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <DateRangeProvider>
          <SidebarProvider defaultOpen={defaultOpen}>{children}</SidebarProvider>
        </DateRangeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockPendingFetch(categorizeCount: number, loanSplitCount: number, paymentEnabled = false) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes("/health")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          firefly_base_url_configured: true,
          firefly_api_token_configured: true,
          openrouter_configured: false,
          sidecar_writable: true,
          payment_worksheet_enabled: paymentEnabled,
        }),
        { status: 200 },
      )
    }
    if (url.includes("/api/categorize/pending")) {
      return new Response(
        JSON.stringify({
          data: [],
          meta: { count: categorizeCount, ...RANGE, limit: 50 },
        }),
        { status: 200 },
      )
    }
    if (url.includes("/api/loan-splits/pending")) {
      return new Response(
        JSON.stringify({
          data: [],
          meta: { count: loanSplitCount, ...RANGE, forward_only_since: RANGE.start },
        }),
        { status: 200 },
      )
    }
    return new Response("not found", { status: 404 })
  })
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

function renderSidebar(initialEntry: string, defaultOpen = true) {
  return render(
    <TestProviders initialEntries={[initialEntry]} defaultOpen={defaultOpen}>
      <AppSidebar />
    </TestProviders>,
  )
}

function getSidebarState(): string | null {
  return document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") ?? null
}

function logoToggleButton(): HTMLElement {
  const button = document.querySelector('[data-sidebar="logo-toggle"]')
  expect(button).toBeTruthy()
  return button as HTMLElement
}

function menuButtonForPath(path: string): HTMLElement {
  const link = document.querySelector(`a[href="${path}"]`)
  expect(link).toBeTruthy()
  const button =
    link!.querySelector('[data-sidebar="menu-button"]') ??
    (link!.matches('[data-sidebar="menu-button"]') ? link : null)
  expect(button).toBeTruthy()
  return button as HTMLElement
}

function expectActive(path: string, active: boolean) {
  expect(menuButtonForPath(path).getAttribute("data-active")).toBe(
    active ? "true" : "false"
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("useManageQueueCounts", () => {
  function HookProbe() {
    const counts = useManageQueueCounts()
    return (
      <div
        data-testid="counts"
        data-categorize={counts.categorizeCount}
        data-loans={counts.loanSplitCount}
        data-loading={counts.isLoading}
      />
    )
  }

  it("returns correct counts for a fixed date range", async () => {
    mockPendingFetch(3, 2)

    render(
      <TestProviders>
        <HookProbe />
      </TestProviders>,
    )

    await waitFor(() => {
      const el = screen.getByTestId("counts")
      expect(el.getAttribute("data-categorize")).toBe("3")
      expect(el.getAttribute("data-loans")).toBe("2")
    })
  })

  it("returns zero counts when APIs return empty data with count 0", async () => {
    mockPendingFetch(0, 0)

    render(
      <TestProviders>
        <HookProbe />
      </TestProviders>,
    )

    await waitFor(() => {
      const el = screen.getByTestId("counts")
      expect(el.getAttribute("data-categorize")).toBe("0")
      expect(el.getAttribute("data-loans")).toBe("0")
    })
  })
})

describe("AppSidebar Manage section", () => {
  beforeEach(() => {
    mockPendingFetch(0, 0)
  })

  it("renders Manage group with Categorize and Loans links", async () => {
    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Manage")).toBeTruthy()
    })
    expect(document.querySelector('a[href="/manage/categorize"]')).toBeTruthy()
    expect(document.querySelector('a[href="/manage/loans/queue"]')).toBeTruthy()
  })

  it("shows badge with pending count when mock fetch returns nonzero", async () => {
    mockPendingFetch(5, 0)

    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("5")).toBeTruthy()
    })
  })

  it("omits badge when count is zero", async () => {
    mockPendingFetch(0, 0)

    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(document.querySelector('[data-sidebar="menu-badge"]')).toBeNull()
    })
  })

  it("hides Bill Pay nav when payment_worksheet_enabled is false", async () => {
    mockPendingFetch(0, 0, false)

    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Manage")).toBeTruthy()
    })
    expect(screen.queryByText("Bill Pay")).toBeNull()
    expect(document.querySelector('a[href="/manage/payment-run"]')).toBeNull()
  })

  it("shows Bill Pay group when payment_worksheet_enabled is true", async () => {
    mockPendingFetch(0, 0, true)

    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Bill Pay")).toBeTruthy()
      expect(document.querySelector('a[href="/manage/payment-run"]')).toBeTruthy()
      expect(screen.getByText("Worksheet")).toBeTruthy()
    })
  })

  it("shows Bill Discovery under Bill Pay when payment_worksheet_enabled is true", async () => {
    mockPendingFetch(0, 0, true)

    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      const link = document.querySelector(
        'a[href="/manage/payment-run/discover"]',
      )
      expect(link).toBeTruthy()
      expect(link?.textContent).toContain("Bill Discovery")
    })
  })

  it("hides Bill Discovery when payment_worksheet_enabled is false", async () => {
    mockPendingFetch(0, 0, false)

    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Manage")).toBeTruthy()
    })
    expect(
      document.querySelector('a[href="/manage/payment-run/discover"]'),
    ).toBeNull()
  })

  it("hides Bills nav when payment_worksheet_enabled is false", async () => {
    mockPendingFetch(0, 0, false)

    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Manage")).toBeTruthy()
    })
    expect(document.querySelector('a[href="/manage/bills"]')).toBeNull()
  })

  it("shows Bills under Bill Pay when payment_worksheet_enabled is true", async () => {
    mockPendingFetch(0, 0, true)

    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(document.querySelector('a[href="/manage/bills"]')).toBeTruthy()
      expect(
        document.querySelector('a[href="/manage/payment-run/cards"]'),
      ).toBeTruthy()
      expect(document.querySelector('a[href="/manage/liabilities"]')).toBeTruthy()
      expect(
        document.querySelector('a[href="/manage/payment-run/buckets"]'),
      ).toBeTruthy()
    })
  })

  it("does not show retired Payment setup nav", async () => {
    mockPendingFetch(0, 0, true)

    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText("Bill Pay")).toBeTruthy()
    })
    expect(
      document.querySelector('a[href="/manage/payment-run/setup"]'),
    ).toBeNull()
  })

  it("renders Clear cache control in the footer", async () => {
    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Clear reference cache" }),
      ).toBeTruthy()
    })
    expect(screen.getByText("Clear cache")).toBeTruthy()
  })

  it("renders sidebar toggle in the header", async () => {
    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Toggle sidebar" }).length,
      ).toBeGreaterThanOrEqual(1)
    })
    expect(document.querySelector('[data-sidebar="trigger"]')).toBeTruthy()
    expect(logoToggleButton()).toBeTruthy()
  })
})

describe("AppSidebar logo toggle", () => {
  beforeEach(() => {
    mockPendingFetch(0, 0)
  })

  it("expands the sidebar when the logo is clicked while collapsed", async () => {
    render(
      <TestProviders defaultOpen={false}>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(getSidebarState()).toBe("collapsed")
    })

    fireEvent.click(logoToggleButton())

    await waitFor(() => {
      expect(getSidebarState()).toBe("expanded")
    })
  })

  it("collapses the sidebar when the logo is clicked while expanded", async () => {
    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(getSidebarState()).toBe("expanded")
    })

    fireEvent.click(logoToggleButton())

    await waitFor(() => {
      expect(getSidebarState()).toBe("collapsed")
    })
  })

  it("keeps SidebarTrigger visible and functional when expanded", async () => {
    render(
      <TestProviders>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(getSidebarState()).toBe("expanded")
    })

    const trigger = document.querySelector(
      '[data-sidebar="trigger"]',
    ) as HTMLElement
    expect(trigger).toBeTruthy()

    fireEvent.click(trigger)

    await waitFor(() => {
      expect(getSidebarState()).toBe("collapsed")
    })
  })

  it("renders a larger logo mark in collapsed icon mode", async () => {
    render(
      <TestProviders defaultOpen={false}>
        <AppSidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(getSidebarState()).toBe("collapsed")
    })

    const logo = logoToggleButton().querySelector("svg")
    expect(logo).toBeTruthy()
    expect(logo?.getAttribute("class")).toContain("size-8")
    expect(logo?.getAttribute("class")).not.toContain("size-6")
  })
})

describe("AppSidebar Charts section", () => {
  beforeEach(() => {
    mockPendingFetch(0, 0)
  })

  it("renders a Charts group with chart-type nav only (no lens toggle in sidebar)", () => {
    renderSidebar("/reports/spending")
    const groupLabelText = Array.from(
      document.querySelectorAll('[data-sidebar="group-label"]'),
    ).map((el) => el.textContent?.trim())
    expect(groupLabelText.some((text) => text === "Charts")).toBe(true)
    expect(groupLabelText.some((text) => text === "Manage")).toBe(true)
    expect(groupLabelText.some((text) => text === "Spending")).toBe(false)
    expect(groupLabelText.some((text) => text === "Cash Flow")).toBe(false)
    expect(screen.queryByRole("group", { name: "Report lens" })).toBeNull()
  })

  it("builds chart nav links from the active cash-flow lens", () => {
    renderSidebar("/reports/cash-flow/trends")
    expect(document.querySelector('a[href="/reports/cash-flow/trends"]')).toBeTruthy()
    expect(document.querySelector('a[href="/reports/spending/trends"]')).toBeNull()
  })

  it("builds chart nav links from spending lens when not on a chart route", () => {
    renderSidebar("/")
    expect(document.querySelector('a[href="/reports/spending"]')).toBeTruthy()
    expect(document.querySelector('a[href="/reports/cash-flow"]')).toBeNull()
  })
})

describe("AppSidebar active nav state", () => {
  beforeEach(() => {
    mockPendingFetch(0, 0)
  })
  it("highlights Spending Bar on /reports/spending", () => {
    renderSidebar("/reports/spending")
    expectActive("/reports/spending", true)
    expectActive("/reports/spending/trends", false)
  })

  it("highlights Line/Trend only on /reports/spending/trends", () => {
    renderSidebar("/reports/spending/trends")
    expectActive("/reports/spending/trends", true)
    expectActive("/reports/spending", false)
  })

  it("highlights Cash Flow Bar on /reports/cash-flow", () => {
    renderSidebar("/reports/cash-flow")
    expectActive("/reports/cash-flow", true)
    expectActive("/reports/cash-flow/trends", false)
  })

  it("highlights Cash Flow Line/Trend only on /reports/cash-flow/trends", () => {
    renderSidebar("/reports/cash-flow/trends")
    expectActive("/reports/cash-flow/trends", true)
    expectActive("/reports/cash-flow", false)
  })

  it("highlights Cash Flow Sankey on /reports/cash-flow/sankey", () => {
    renderSidebar("/reports/cash-flow/sankey")
    expectActive("/reports/cash-flow/sankey", true)
    expectActive("/reports/cash-flow", false)
    expectActive("/reports/cash-flow/trends", false)
  })

  it("highlights Spending Sankey on /reports/spending/sankey", () => {
    renderSidebar("/reports/spending/sankey")
    expectActive("/reports/spending/sankey", true)
    expectActive("/reports/spending", false)
    expectActive("/reports/spending/trends", false)
  })

  it("highlights Spending Variance on /reports/spending/mom", () => {
    renderSidebar("/reports/spending/mom")
    expectActive("/reports/spending/mom", true)
    expectActive("/reports/spending", false)
  })

  it("highlights Cash Flow Variance on /reports/cash-flow/mom", () => {
    renderSidebar("/reports/cash-flow/mom")
    expectActive("/reports/cash-flow/mom", true)
    expectActive("/reports/cash-flow", false)
  })

  it("does not include legacy /reports/sankey nav item", () => {
    renderSidebar("/reports/spending/sankey")
    const legacyLink = document.querySelector('a[href="/reports/sankey"]')
    expect(legacyLink).toBeNull()
  })

  it("highlights Dashboard on /", () => {
    renderSidebar("/")
    expectActive("/", true)
  })

  it("highlights About on /about", () => {
    renderSidebar("/about")
    expectActive("/about", true)
    expectActive("/", false)
  })
})
