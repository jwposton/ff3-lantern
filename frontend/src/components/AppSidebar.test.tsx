import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { SidebarProvider } from "@/components/ui/sidebar"

import { AppSidebar } from "./AppSidebar"

beforeAll(() => {
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

function renderSidebar(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>
  )
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
})

describe("AppSidebar active nav state", () => {
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

  it("highlights Dashboard on /", () => {
    renderSidebar("/")
    expectActive("/", true)
  })
})
