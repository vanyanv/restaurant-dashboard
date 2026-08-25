// @vitest-environment jsdom
/**
 * `Spark` against `spark()` at line 3770 of
 * `docs/counter/counter-prototype.html`. The path maths lives in
 * `tests/lib/counter/bullet-state.test.ts`; this is the SVG the ported
 * stylesheet styles — `.sp path.ln`, `.sp path.ar`, `.sp circle`.
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { Spark } from "@/components/counter/surface/spark"

describe("Spark", () => {
  it("renders nothing at all for fewer than two points", () => {
    expect(render(<Spark series={[]} />).container.innerHTML).toBe("")
    expect(render(<Spark series={[7]} />).container.innerHTML).toBe("")
    expect(render(<Spark series={undefined} />).container.innerHTML).toBe("")
  })

  it("is a 100x15 viewBox stretched to the cell, not letterboxed inside it", () => {
    const { container } = render(<Spark series={[1, 2, 3]} />)
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 15")
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none")
  })

  it("is decoration: hidden from the reader and out of the tab order", () => {
    const { container } = render(<Spark series={[1, 2, 3]} />)
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("aria-hidden")).toBe("true")
    expect(svg.getAttribute("focusable")).toBe("false")
  })

  it("has three children in order: the area, the line, then the dot", () => {
    const { container } = render(<Spark series={[1, 2, 3]} />)
    const kids = [...container.querySelector("svg")!.children]
    expect(kids.map((k) => `${k.tagName.toLowerCase()}.${k.getAttribute("class") ?? ""}`)).toEqual([
      "path.ar",
      "path.ln",
      "circle.",
    ])
  })

  it("closes the area down to the baseline so `.sp path.ar` has something to fill", () => {
    const { container } = render(<Spark series={[1, 2, 3]} />)
    const line = container.querySelector("path.ln")!.getAttribute("d")!
    expect(container.querySelector("path.ar")!.getAttribute("d")).toBe(`${line}L100 15L0 15Z`)
    expect(line).toBe("M0.0 13.4L50.0 7.5L100.0 1.6")
  })

  it("puts the dot on the last point, at the prototype's radius", () => {
    const { container } = render(<Spark series={[1, 2, 3]} />)
    const dot = container.querySelector("circle")!
    expect(dot.getAttribute("cx")).toBe("100.0")
    expect(dot.getAttribute("cy")).toBe("1.6")
    expect(dot.getAttribute("r")).toBe("1.7")
  })

  it("tints the whole mark when told the figure is in breach", () => {
    expect(render(<Spark series={[1, 2]} />).container.querySelector("svg")!.getAttribute("class"))
      .toBe("sp")
    expect(
      render(<Spark series={[1, 2]} breach />).container.querySelector("svg")!.getAttribute("class"),
    ).toBe("sp is-breach")
  })
})
