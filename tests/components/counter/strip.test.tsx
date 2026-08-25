// @vitest-environment jsdom
/**
 * `Strip` and `Figure` against the prototype's own `strip()`
 * (`docs/counter/counter-prototype.html` line 3008). These tests are about
 * DOM: class names, element order, and the attributes the ported stylesheet
 * and the fidelity gate both read. What the numbers mean is
 * `tests/lib/counter/bullet-state.test.ts`.
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Figure } from "@/components/counter/surface/figure"
import { Strip } from "@/components/counter/surface/strip"
import type { Reference } from "@/lib/counter/bullet-state"

/** The tag/class sequence of a cell's direct children, in document order. */
function shapeOf(cell: Element): string[] {
  return [...cell.children].map((el) => {
    const cls = el.getAttribute("class")
    return cls ? `${el.tagName.toLowerCase()}.${cls.split(/\s+/)[0]}` : el.tagName.toLowerCase()
  })
}

describe("Figure — the prototype's cell, in the prototype's order", () => {
  it("emits k then v, and nothing else, for a bare figure", () => {
    const { container } = render(<Figure label="Net sales" value="$7,468" />)
    expect(shapeOf(container.firstElementChild!)).toEqual(["span.k", "span.v"])
    expect(screen.getByText("Net sales").className).toBe("k")
  })

  it("puts the value SECOND, immediately after the label", () => {
    // The brief's table omits `.v`; the prototype emits it right after `.k`.
    const { container } = render(<Figure label="Orders" value="376" delta="▲ 5.1%" />)
    expect(shapeOf(container.firstElementChild!)).toEqual(["span.k", "span.v", "span.d"])
  })

  it("emits every part in order: k, v, sp, d, blt, band", () => {
    const reference: Reference = {
      v: 150,
      lo: 100,
      hi: 200,
      better: "high",
      label: "Orders 150, inside its band",
      series: [1, 2, 3, 4],
    }
    const { container } = render(
      <Figure
        label="Orders"
        value="150"
        delta="▲ 5.1%"
        caption="band 100–200"
        reference={reference}
      />,
    )
    expect(shapeOf(container.firstElementChild!)).toEqual([
      "span.k",
      "span.v",
      "svg.sp",
      "span.d",
      "span.blt",
      "span.band",
    ])
  })

  it("a strip cell is a BARE div — `.strip > div` is what styles it", () => {
    const { container } = render(<Figure label="a" value="1" />)
    expect(container.firstElementChild!.getAttribute("class")).toBeNull()
  })

  it("a lead figure is `.fig`, matching the prototype's headline block", () => {
    const { container } = render(<Figure label="a" value="1" size="lead" />)
    expect(container.firstElementChild!.className).toBe("fig")
  })

  it("emits a bare `.v`, exactly as the prototype does — no numeral utility", () => {
    // Tabular lining numerals are inherited from the root, not restated per
    // figure: `counter-components.css`'s `.ct-root` block declares
    // `font-variant-numeric: tabular-nums lining-nums`, and
    // tests/styles/counter-components.test.ts is what holds it there. A
    // utility here would be a second opinion about the same property.
    render(<Figure label="Net sales" value="$7,468" />)
    expect(screen.getByText("$7,468").className).toBe("v")
  })

  it("renders label, value and caption", () => {
    render(<Figure label="Net sales" value="$7,468" caption="gross $9,681" />)
    expect(screen.getByText("Net sales")).toBeTruthy()
    expect(screen.getByText("$7,468")).toBeTruthy()
    expect(screen.getByText("gross $9,681")).toBeTruthy()
  })
})

describe("Figure — the delta's tone", () => {
  it("is bare `.d` by default, because `.strip .d` is already the good colour", () => {
    render(<Figure label="a" value="1" delta="▲ 11.4%" />)
    expect(screen.getByText("▲ 11.4%").className).toBe("d")
  })

  it("carries the tone class when one is given", () => {
    render(<Figure label="a" value="1" delta="▼ 3.2%" deltaTone="is-down" />)
    expect(screen.getByText("▼ 3.2%").className).toBe("d is-down")
  })

  it("omits the delta element entirely when there is no delta", () => {
    const { container } = render(<Figure label="a" value="1" />)
    expect(container.querySelector(".d")).toBeNull()
  })
})

describe("Figure — the band and its flag", () => {
  const breached: Reference = { v: 50, lo: 100, hi: 200, better: "high" }

  it("puts the flag inside the band, before the caption, with a space between", () => {
    const { container } = render(
      <Figure label="a" value="1" caption="band 100–200" reference={breached} />,
    )
    const band = container.querySelector(".band")!
    expect(band.querySelector(".flag")!.className).toBe("flag is-breach")
    expect(band.textContent).toBe("under band 100–200")
  })

  it("gives the flag its own dot element, which is what `.flag i` paints", () => {
    const { container } = render(<Figure label="a" value="1" reference={breached} />)
    expect(container.querySelector(".flag > i")).not.toBeNull()
  })

  it("says nothing when the figure is ok, but still opens the band", () => {
    const { container } = render(
      <Figure
        label="a"
        value="1"
        caption="band 100–200"
        reference={{ v: 150, lo: 100, hi: 200, better: "high" }}
      />,
    )
    expect(container.querySelector(".flag")).toBeNull()
    expect(container.querySelector(".band")!.textContent).toBe("band 100–200")
  })

  it("draws the meter but says nothing about it when the reference is quiet", () => {
    const { container } = render(
      <Figure label="a" value="1" caption="band 100–200" reference={{ ...breached, quiet: true }} />,
    )
    expect(container.querySelector(".blt")).not.toBeNull()
    expect(container.querySelector(".flag")).toBeNull()
  })

  it("opens a band for a reference alone, even one with nothing to put in it", () => {
    // The prototype's `c[4] || r`.
    const { container } = render(
      <Figure label="a" value="1" reference={{ v: 1, better: "high", series: [1, 2] }} />,
    )
    expect(container.querySelector(".band")).not.toBeNull()
    expect(container.querySelector(".blt")).toBeNull()
  })

  it("omits the band when there is neither a caption nor a reference", () => {
    const { container } = render(<Figure label="a" value="1" delta="▲ 1%" />)
    expect(container.querySelector(".band")).toBeNull()
  })

  it("uses `.hfloor` rather than `.band` at lead scale, matching floorMeter()", () => {
    const { container } = render(
      <Figure label="a" value="1" size="lead" caption="Floor $4.10" reference={breached} />,
    )
    expect(container.querySelector(".band")).toBeNull()
    expect(container.querySelector(".hfloor")!.textContent).toBe("under Floor $4.10")
    expect(container.querySelector(".blt")!.className).toBe("blt blt--lead")
  })
})

describe("Figure — the sparkline it hands down", () => {
  it("draws one only when the reference carries a series", () => {
    const { container: without } = render(<Figure label="a" value="1" />)
    expect(without.querySelector(".sp")).toBeNull()

    const { container: with_ } = render(
      <Figure label="a" value="1" reference={{ v: 1, better: "high", series: [1, 2, 3] }} />,
    )
    expect(with_.querySelector(".sp")).not.toBeNull()
  })

  it("tints it red only when a judged, unquiet reference is in breach", () => {
    const series = [1, 2, 3]
    const { container: ok } = render(
      <Figure label="a" value="1" reference={{ v: 150, lo: 100, hi: 200, better: "high", series }} />,
    )
    expect(ok.querySelector(".sp")!.getAttribute("class")).toBe("sp")

    const { container: bad } = render(
      <Figure label="a" value="1" reference={{ v: 50, lo: 100, hi: 200, better: "high", series }} />,
    )
    expect(bad.querySelector(".sp")!.getAttribute("class")).toBe("sp is-breach")

    const { container: quiet } = render(
      <Figure
        label="a"
        value="1"
        reference={{ v: 50, lo: 100, hi: 200, better: "high", quiet: true, series }}
      />,
    )
    expect(quiet.querySelector(".sp")!.getAttribute("class")).toBe("sp")
  })

  it("draws no spark for a series with a single point", () => {
    const { container } = render(
      <Figure label="a" value="1" reference={{ v: 1, better: "high", series: [7] }} />,
    )
    expect(container.querySelector(".sp")).toBeNull()
  })
})

describe("Strip", () => {
  const cells = [
    { label: "Net sales", value: "$7,468" },
    { label: "Orders", value: "376" },
    { label: "Avg ticket", value: "$19.86" },
  ]

  it("is a `.strip` whose cells are bare divs", () => {
    const { container } = render(<Strip cells={cells} />)
    const strip = container.querySelector(".strip")!
    expect(strip.children).toHaveLength(3)
    for (const cell of strip.children) {
      expect(cell.tagName).toBe("DIV")
      expect(cell.getAttribute("class")).toBeNull()
    }
  })

  it("records the cell count in data-n, which IS the grid's track count", () => {
    // `.strip` is six tracks by default; only data-n 2..5 override it. Without
    // the attribute a three-cell strip lays out across six columns.
    const { container } = render(<Strip cells={cells} />)
    expect(container.querySelector(".strip")!.getAttribute("data-n")).toBe("3")
  })

  it("renders one cell per figure", () => {
    const { container } = render(<Strip cells={cells} />)
    expect(container.querySelectorAll("[data-figure-value]")).toHaveLength(3)
  })

  it("the cell count is just the length of what it's given — no separate count to pass or drift", () => {
    const { container } = render(<Strip cells={cells.slice(0, 2)} />)
    expect(container.querySelectorAll("[data-figure-value]")).toHaveLength(2)
    expect(container.querySelector(".strip")!.getAttribute("data-n")).toBe("2")
  })

  it("reports a cell count the stylesheet has no rule for rather than clamping it", () => {
    // `.strip[data-n]` covers 2..5, with six as the default. One cell and seven
    // cells both fall through to the six-track default and lay out wrong — a
    // real hole, recorded here rather than hidden by a lie to the gate that
    // reads this attribute. See strip.tsx.
    const { container: one } = render(<Strip cells={cells.slice(0, 1)} />)
    expect(one.querySelector(".strip")!.getAttribute("data-n")).toBe("1")

    const many = Array.from({ length: 7 }, (_, i) => ({ label: `l${i}`, value: `${i}` }))
    const { container: seven } = render(<Strip cells={many} />)
    expect(seven.querySelector(".strip")!.getAttribute("data-n")).toBe("7")
  })

  it("forces its children to cell size — a lead figure inside a strip is a mistake", () => {
    const { container } = render(<Strip cells={[{ label: "a", value: "1", size: "lead" }]} />)
    expect(container.querySelector(".fig")).toBeNull()
  })

  it("renders whatever values it's handed, including a caller-supplied em-dash", () => {
    render(<Strip cells={[{ label: "Net sales", value: "—" }]} />)
    expect(screen.getByText("—")).toBeTruthy()
  })
})
