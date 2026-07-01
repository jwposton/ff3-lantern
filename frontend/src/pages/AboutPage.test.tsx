import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { AboutPage } from "./AboutPage"

afterEach(() => {
  cleanup()
})

describe("AboutPage", () => {
  it("shows Noun Project icon attributions", () => {
    render(<AboutPage />)

    expect(screen.getByRole("heading", { name: "About" })).toBeTruthy()
    expect(screen.getByText("v1.1.10")).toBeTruthy()
    expect(screen.getByText(/Sankey Chart by Kirby Wu/i)).toBeTruthy()
    expect(screen.getByText(/age picture diagram by birdpeople/i)).toBeTruthy()
    expect(screen.getAllByText(/CC BY 3.0/i).length).toBeGreaterThanOrEqual(2)
  })
})
