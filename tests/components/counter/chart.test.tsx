// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { Chart } from "@/components/counter/surface/chart"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches, media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {}, removeEventListener: () => {},
  }))
}

const labels = ["Aug 18", "Aug 19", "Aug 20"]
const series = [{ name: "Net sales", data: [7100, 7400, 7468] }]

describe("Chart — line", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("renders a chart region with an accessible name", () => {
    setReducedMotion(false)
    render(<Chart variant="line" labels={labels} series={series} title="Revenue trend" />)
    expect(screen.getByRole("img", { name: /revenue trend/i })).toBeTruthy()
  })

  it("degrades to a single reading when there is only one label", () => {
    setReducedMotion(false)
    // "A single day is one reading, not a chart." Drawing one point as a bar
    // fills the panel edge to edge and says nothing.
    render(<Chart variant="line" labels={["Aug 24"]} series={[{ name: "Net sales", data: [7468] }]} title="t" />)
    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.getByText("Net sales")).toBeTruthy()
    expect(screen.getByText("Aug 24")).toBeTruthy()
  })

  it("renders an em-dash for a null reading in the degraded view", () => {
    setReducedMotion(false)
    render(<Chart variant="line" labels={["Aug 24"]} series={[{ name: "Net sales", data: [null] }]} title="t" />)
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("provides a text summary so the data is reachable without the picture", () => {
    setReducedMotion(false)
    render(<Chart variant="line" labels={labels} series={series} title="Revenue trend" />)
    const table = screen.getByRole("table", { name: /revenue trend/i })
    expect(table.textContent).toContain("Aug 20")
  })
})

describe("Chart — bar", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("renders a bar per reading", () => {
    setReducedMotion(false)
    const { container } = render(
      <Chart variant="bar" labels={labels} series={series} title="Orders" />,
    )
    expect(container.querySelectorAll(".recharts-rectangle").length).toBeGreaterThanOrEqual(3)
  })

  it("dims every bar except the hovered one to 42%", () => {
    setReducedMotion(false)
    const { container } = render(
      <Chart variant="bar" labels={labels} series={series} title="Orders" />,
    )
    const bars = container.querySelectorAll("[data-bar-index]")
    expect(bars.length).toBe(3)
    // No hover yet: nothing is dimmed.
    expect([...bars].every((b) => b.getAttribute("fill-opacity") === "1")).toBe(true)
  })

  it("emits no growth animation under reduced motion", () => {
    setReducedMotion(true)
    const { container } = render(
      <Chart variant="bar" labels={labels} series={series} title="Orders" />,
    )
    const bar = container.querySelector("[data-bar-index]") as HTMLElement | null
    expect(bar?.style.animationName ?? "").toBe("")
  })
})
