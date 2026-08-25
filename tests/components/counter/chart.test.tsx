// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Chart } from "@/components/counter/surface/chart"
import type { ChartProps } from "@/components/counter/surface/chart"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

const INK = "var(--ink)"
const QUIET = "var(--ink-3)"
const labels = ["Aug 18", "Aug 19", "Aug 20"]
const net = { name: "Net sales", data: [7100, 7400, 7468], color: INK }

function draw(props: Partial<ChartProps> = {}) {
  return render(<Chart labels={labels} series={[net]} {...props} />)
}

/**
 * jsdom has no layout, so `getBoundingClientRect()` is all zeros and the
 * pointer handler bails on a zero-width host. Give the plot a width, then
 * point at it.
 */
function pointAt(host: Element, ratio: number) {
  host.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 700, bottom: 150, width: 700, height: 150, x: 0, y: 0 }) as DOMRect
  fireEvent.pointerMove(host, { clientX: ratio * 700 })
}

describe("Chart — the prototype's DOM", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("draws into a .ch with an accessible SVG picture", () => {
    setReducedMotion(false)
    const { container } = draw({ alt: "Revenue trend" })
    const ch = container.querySelector(".ch")
    expect(ch).toBeTruthy()
    const svg = ch?.querySelector("svg")
    expect(svg?.getAttribute("role")).toBe("img")
    expect(svg?.getAttribute("aria-label")).toBe("Revenue trend")
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("none")
  })

  it("names the picture after the first series when no alt is given", () => {
    setReducedMotion(false)
    const { container } = draw()
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Net sales")
  })

  it("puts the axis and the legend BESIDE the plot, not inside it", () => {
    setReducedMotion(false)
    // `chart()` returns three sibling elements. A legend nested inside the
    // plot would be positioned by `.ch`'s own stacking context and every
    // `.ch-legend` rule would be measuring the wrong box.
    const { container } = draw({ legend: true })
    const ch = container.querySelector(".ch") as HTMLElement
    const axis = container.querySelector(".axis") as HTMLElement
    const legend = container.querySelector(".ch-legend") as HTMLElement
    expect(axis).toBeTruthy()
    expect(legend).toBeTruthy()
    expect(ch.contains(axis)).toBe(false)
    expect(ch.contains(legend)).toBe(false)
    expect(axis.previousElementSibling).toBe(ch)
    expect(legend.previousElementSibling).toBe(axis)
  })

  it("drops the axis entirely when the caller says ticks:false", () => {
    setReducedMotion(false)
    expect(draw({ ticks: false }).container.querySelector(".axis")).toBeNull()
  })

  it("labels every bar, but only the ends and the middle of a line", () => {
    setReducedMotion(false)
    const seven = ["a", "b", "c", "d", "e", "f", "g"]
    const long = { name: "Net sales", data: [1, 2, 3, 4, 5, 6, 7], color: INK }
    const line = render(<Chart labels={seven} series={[long]} />)
    expect([...line.container.querySelectorAll(".axis span")].map((s) => s.textContent)).toEqual([
      "a",
      "d",
      "g",
    ])
    line.unmount()
    const bars = render(<Chart type="bars" labels={seven} series={[long]} />)
    expect(bars.container.querySelectorAll(".axis span")).toHaveLength(7)
  })

  it("keeps the tooltip inside .ch, where it is positioned absolutely", () => {
    setReducedMotion(false)
    // Every direct child of `.screen` carries a FILLING entry animation whose
    // `to` state is `transform: none`, which Chromium computes as the
    // identity matrix — so every section is a containing block for fixed
    // descendants and a `position: fixed` card would be trapped 9px down.
    // `.ch-tip` is absolute inside `.ch`, so the hazard cannot reach it.
    const { container } = draw()
    const ch = container.querySelector(".ch") as HTMLElement
    const tip = container.querySelector(".ch-tip") as HTMLElement
    expect(ch.contains(tip)).toBe(true)
  })
})

describe("Chart — the comparison is a dashed reference", () => {
  beforeEach(() => vi.unstubAllGlobals())

  const cmp = { name: "Last year", data: [6900, 7000, 7100], color: QUIET, dash: true }

  it("gives the comparison series path.chref and the measure none", () => {
    setReducedMotion(false)
    // Note 40: the comparison is ONE dashed reference, not a second solid
    // line. `.ch svg path.chref` is the only rule that dashes it.
    const { container } = draw({ series: [net, cmp] })
    const paths = [...container.querySelectorAll(".ch svg path")]
    const chref = paths.filter((p) => p.classList.contains("chref"))
    expect(chref).toHaveLength(1)
    expect(chref[0].getAttribute("stroke")).toBe(QUIET)
    const solid = paths.filter((p) => p.hasAttribute("data-draw"))
    expect(solid.every((p) => !p.classList.contains("chref"))).toBe(true)
  })

  it("marks the dashed entry in the legend with i.dsh and a border, not a fill", () => {
    setReducedMotion(false)
    const { container } = draw({ series: [net, cmp], legend: true })
    const swatches = [...container.querySelectorAll(".ch-legend i")] as HTMLElement[]
    expect(swatches).toHaveLength(2)
    expect(swatches[0].classList.contains("dsh")).toBe(false)
    expect(swatches[0].style.background).toBe(INK)
    expect(swatches[1].classList.contains("dsh")).toBe(true)
    expect(swatches[1].style.borderColor).toBe(QUIET)
    expect(swatches[1].style.background).toBe("")
  })

  it("draws the reference as a line even on a bar chart", () => {
    setReducedMotion(false)
    const { container } = draw({ type: "bars", series: [net, { ...cmp, as: "line" }] })
    expect(container.querySelectorAll(".chbar")).toHaveLength(3)
    expect(container.querySelectorAll("path.chref")).toHaveLength(1)
  })

  it("reads the measure against the reference in the tooltip", () => {
    setReducedMotion(false)
    const { container } = draw({
      series: [net, { name: "Last year", data: [7000, 7000, 7000], color: QUIET, dash: true }],
      vs: 1,
      vsLabel: "against last year",
    })
    pointAt(container.querySelector(".ch") as Element, 1)
    expect(container.querySelector(".ch-tip")?.textContent).toContain("▲ 6.7% against last year")
  })
})

describe("Chart — bars", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("emits one .chbar per reading, tagged with its index", () => {
    setReducedMotion(false)
    const { container } = draw({ type: "bars" })
    const bars = [...container.querySelectorAll(".chbar")]
    expect(bars.map((b) => b.getAttribute("data-i"))).toEqual(["0", "1", "2"])
  })

  it("renders a below-baseline reading instead of nothing at all", () => {
    setReducedMotion(false)
    // A negative SVG `rect` height is invalid: an earlier version of this
    // component drew a below-baseline value as literally nothing.
    const { container } = draw({
      type: "bars",
      zero: true,
      series: [{ name: "Variance", data: [-40, 12, -8], color: INK }],
    })
    const bars = [...container.querySelectorAll(".chbar")]
    expect(bars).toHaveLength(3)
    for (const b of bars) {
      const h = Number(b.getAttribute("height"))
      expect(Number.isFinite(h)).toBe(true)
      expect(h).toBeGreaterThan(0)
    }
  })

  it("marks the hovered bar .on and leaves the others for CSS to dim", () => {
    setReducedMotion(false)
    // The 42% dim is `.ch.is-live .chbar` / `.chbar.on` — pure CSS. There is
    // no per-datum React element and no `Cell`.
    // A GAP in the middle, so a bar's position in the emitted list is not
    // its reading index. Matching on the wrong one of those two passes on
    // any gapless series.
    const { container } = draw({
      type: "bars",
      series: [{ name: "Orders", data: [180, null, 204], color: INK }],
    })
    const ch = container.querySelector(".ch") as Element
    expect(container.querySelectorAll(".chbar")).toHaveLength(2)
    pointAt(ch, 0.9)
    expect(ch.classList.contains("is-live")).toBe(true)
    const on = [...container.querySelectorAll(".chbar.on")]
    expect(on).toHaveLength(1)
    expect(on[0].getAttribute("data-i")).toBe("2")
  })
})

describe("Chart — hover", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("goes live and names the bucket, its readings and its extras", () => {
    setReducedMotion(false)
    const { container } = draw({
      fmt: (v) => `$${v}`,
      band: { lo: [7000, 7100, 7200], hi: [7300, 7500, 7700] },
      rule: { v: 7200, label: "Floor" },
      notes: [undefined, "Closed at 4pm", undefined],
    })
    const ch = container.querySelector(".ch") as Element
    pointAt(ch, 0.5)
    expect(ch.classList.contains("is-live")).toBe(true)
    const tip = container.querySelector(".ch-tip") as HTMLElement
    expect(tip.querySelector(".lb")?.textContent).toBe("Aug 19")
    expect(tip.querySelector(".rw")?.textContent).toBe("Net sales$7400")
    expect([...tip.querySelectorAll(".ex")].map((e) => e.textContent)).toEqual([
      "4-week band $7100–$7500",
      "Floor $7200",
      "Closed at 4pm",
    ])
  })

  it("puts a dot on each series that has a reading, and none on one that does not", () => {
    setReducedMotion(false)
    const { container } = draw({
      series: [net, { name: "Last year", data: [null, 7000, 7100], color: QUIET }],
    })
    pointAt(container.querySelector(".ch") as Element, 0)
    const dots = [...container.querySelectorAll(".ch-dot")] as HTMLElement[]
    expect(dots).toHaveLength(2)
    expect(dots[0].style.display).toBe("")
    expect(dots[1].style.display).toBe("none")
  })

  it("stops being live when the pointer leaves", () => {
    setReducedMotion(false)
    const { container } = draw()
    const ch = container.querySelector(".ch") as Element
    pointAt(ch, 0.5)
    expect(ch.classList.contains("is-live")).toBe(true)
    fireEvent.pointerLeave(ch)
    expect(ch.classList.contains("is-live")).toBe(false)
  })
})

describe("Chart — stacked shares", () => {
  beforeEach(() => vi.unstubAllGlobals())

  const shares = [
    { name: "In-house", data: [60, 58, 57], color: INK },
    { name: "DoorDash", data: [25, 26, 27], color: QUIET },
    { name: "Uber Eats", data: [15, 16, 16], color: INK },
  ]

  it("writes every band's name on the band, so identity is never colour alone", () => {
    setReducedMotion(false)
    const { container } = draw({ stack: "pct", series: shares })
    const labs = [...container.querySelectorAll(".ch-lab")] as HTMLElement[]
    expect(labs.map((l) => l.textContent)).toEqual(["In-house57%", "DoorDash27%", "Uber Eats16%"])
    for (const l of labs) expect(l.style.top.endsWith("%")).toBe(true)
  })

  it("prints a name only for a stack of parts — its last bucket is not the range's figure", () => {
    setReducedMotion(false)
    const { container } = draw({ stack: "sum", series: shares })
    expect([...container.querySelectorAll(".ch-lab")].map((l) => l.textContent)).toEqual([
      "In-house",
      "DoorDash",
      "Uber Eats",
    ])
  })

  it("suppresses the direct labels when the caller says so", () => {
    setReducedMotion(false)
    const { container } = draw({ stack: "pct", series: shares, direct: false })
    expect(container.querySelectorAll(".ch-lab")).toHaveLength(0)
  })

  it("draws bands, not bars or dots", () => {
    setReducedMotion(false)
    const { container } = draw({ stack: "pct", series: shares })
    expect(container.querySelectorAll("path[data-fill]")).toHaveLength(3)
    expect(container.querySelectorAll(".chbar")).toHaveLength(0)
    expect(container.querySelectorAll(".ch-dot")).toHaveLength(0)
  })
})

describe("Chart — motion", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("marks the measure for the stroke-on draw once motion is allowed", () => {
    setReducedMotion(false)
    const { container } = draw()
    const path = container.querySelector(".ch svg path[data-draw]") as SVGPathElement
    expect(path).toBeTruthy()
    // `--len` must be written BEFORE `data-draw` appears, or `cndraw` starts
    // against an unresolved `stroke-dasharray: var(--len)` and the first
    // frame shows the finished line.
    expect(path.style.getPropertyValue("--len")).not.toBe("")
  })

  it("draws nothing on and staggers nothing under reduced motion", () => {
    setReducedMotion(true)
    // A LINE chart, for the draw-on: a bar chart emits no path at all, so
    // asserting `[data-draw]` is absent on one proves nothing.
    const line = draw()
    expect(line.container.querySelector(".ch svg path")).toBeTruthy()
    expect(line.container.querySelector("[data-draw]")).toBeNull()
    line.unmount()
    const bars = draw({ type: "bars" })
    const bar = bars.container.querySelector(".chbar") as SVGRectElement
    expect(bar.style.animationDelay).toBe("")
  })

  it("staggers the bars 26ms apart, capped, when motion is allowed", () => {
    setReducedMotion(false)
    const many = Array.from({ length: 16 }, (_, i) => i + 1)
    const { container } = render(
      <Chart
        type="bars"
        labels={many.map(String)}
        series={[{ name: "Orders", data: many, color: INK }]}
      />,
    )
    const bars = [...container.querySelectorAll(".chbar")] as SVGRectElement[]
    expect(bars[0].style.animationDelay).toBe("0ms")
    expect(bars[2].style.animationDelay).toBe("52ms")
    expect(bars[15].style.animationDelay).toBe("320ms")
  })
})

describe("Chart — a single reading is not a chart", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("degrades to a fitted strip carrying no track count", () => {
    setReducedMotion(false)
    // `data-n` IS the strip's grid track count, and `.strip--fit` is flex.
    // Emitting one would put a number in front of the fidelity gate that the
    // design never wrote.
    const { container } = render(
      <Chart labels={["Aug 24"]} series={[{ name: "Net sales", data: [7468], color: INK }]} />,
    )
    const strip = container.querySelector(".strip") as HTMLElement
    expect(strip.classList.contains("strip--fit")).toBe(true)
    expect(strip.hasAttribute("data-n")).toBe(false)
    expect(container.querySelector(".ch")).toBeNull()
    expect(strip.querySelector(".k")?.textContent).toBe("Net sales")
    expect(strip.querySelector(".d")?.textContent).toBe("Aug 24")
    expect(strip.querySelector(".d")?.classList.contains("is-flat")).toBe(true)
  })

  it("writes an em-dash for a reading that was never taken", () => {
    setReducedMotion(false)
    const { container } = render(
      <Chart labels={["Aug 24"]} series={[{ name: "Net sales", data: [null], color: INK }]} />,
    )
    expect(container.querySelector(".v")?.textContent).toBe("—")
  })
})

describe("Chart — reachable without the picture", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("summarises every reading in a table a screen reader can walk", () => {
    setReducedMotion(false)
    draw({ alt: "Revenue trend", fmt: (v) => `$${v}` })
    const table = screen.getByRole("table", { name: /revenue trend/i })
    expect(table.textContent).toContain("Aug 20")
    expect(table.textContent).toContain("$7468")
  })

  it("writes an em-dash in the summary for a gap, never a zero", () => {
    setReducedMotion(false)
    const { container } = draw({ series: [{ name: "Net sales", data: [7100, null, 7468], color: INK }] })
    expect(container.querySelector("table")?.textContent).toContain("—")
  })
})
