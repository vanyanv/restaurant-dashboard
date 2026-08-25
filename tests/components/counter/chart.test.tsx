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

  it("breaks the drawn path at a null reading instead of connecting across it", () => {
    setReducedMotion(false)
    // A gap must read as a gap (format.ts's em-dash rule: absence is not a
    // measurement). Without `connectNulls`, Recharts' path generator starts
    // a new subpath (a second "M") at the null instead of drawing a
    // straight segment across it — assert on that discontinuity in the
    // emitted `d` attribute, since jsdom has no layout to paint a visible
    // gap against.
    const gappyLabels = ["Aug 18", "Aug 19", "Aug 20", "Aug 21"]
    const gappySeries = [{ name: "Net sales", data: [7100, null, 7400, 7468] }]
    const { container } = render(
      <Chart variant="line" labels={gappyLabels} series={gappySeries} title="Revenue trend" />,
    )
    const path = container.querySelector(".recharts-line-curve")
    const d = path?.getAttribute("d") ?? ""
    expect(d.match(/M/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it("renders the value axis compactly rather than in full", () => {
    setReducedMotion(false)
    const bigSeries = [{ name: "Net sales", data: [7100, 14000, 21000] }]
    render(<Chart variant="line" labels={labels} series={bigSeries} title="Revenue trend" />)
    // Scope to the chart picture, not the sr-only summary table — that
    // table intentionally uses the full `money` formatter, only the axis
    // should be compact.
    // Recharts computes its own "nice" tick values rather than echoing the
    // raw data points, so assert on the compact SHAPE (a bare "$<n>K"), not
    // a specific number — and that the full, comma-grouped form never
    // appears on the axis.
    const picture = screen.getByRole("img", { name: /revenue trend/i })
    expect(picture.textContent).toMatch(/\$\d+(\.\d+)?K/)
    expect(picture.textContent).not.toMatch(/\$\d{1,3},\d{3}/)
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

  it("leaves every bar at full opacity before any hover (jsdom can't simulate the hover-dim itself)", () => {
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

  it("emits a positive-height rect for a below-baseline value (geometry, not paint — jsdom has no layout)", () => {
    setReducedMotion(false)
    const negativeSeries = [{ name: "Variance", data: [-40, 12, -8] }]
    const { container } = render(
      <Chart variant="bar" labels={labels} series={negativeSeries} title="Variance" />,
    )
    const bars = container.querySelectorAll(".recharts-rectangle")
    expect(bars.length).toBeGreaterThanOrEqual(3)
    // A raw SVG `<rect>` is invalid (and Recharts computes a negative
    // `baseValueScale - currentValueScale` extent for any below-baseline
    // reading) whenever `height` is negative — the shape must always emit
    // a non-negative height, regardless of which side of the baseline the
    // value fell on.
    for (const bar of bars) {
      const height = Number(bar.getAttribute("height"))
      expect(Number.isNaN(height)).toBe(false)
      expect(height).toBeGreaterThanOrEqual(0)
    }
  })
})
