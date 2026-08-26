// @vitest-environment jsdom
/**
 * `MStrip` against the prototype's own `mstrip()`
 * (`docs/counter/counter-prototype.html` line 3093).
 *
 * The three differences from `strip()` are the whole point of this file: no
 * sparkline, no `data-n`, and a band that needs a reference. Each is asserted
 * against the prototype's source rather than against the brief, which is silent
 * on all three.
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { MStrip } from "@/components/counter/shell/m-strip"
import type { FigureProps } from "@/components/counter/surface/figure"
import type { Reference } from "@/lib/counter/bullet-state"

function shapeOf(el: Element): string[] {
  return [...el.children].map((c) => {
    const cls = c.getAttribute("class")
    return cls ? `${c.tagName.toLowerCase()}.${cls.split(/\s+/).join(".")}` : c.tagName.toLowerCase()
  })
}

const BAND: Reference = {
  v: 24.8,
  lo: 23.9,
  hi: 26.2,
  better: "low",
  label: "Labor inside its band",
}

describe("MStrip — the phone's ruled strip", () => {
  it("wraps bare divs in .mstrip, one per cell", () => {
    const cells: FigureProps[] = [
      { label: "Orders", value: "1,284" },
      { label: "Avg ticket", value: "$25.44" },
    ]
    const { container } = render(<MStrip cells={cells} />)
    const strip = container.firstElementChild!
    expect(strip.className).toBe("mstrip")
    expect(strip.children).toHaveLength(2)
    // A cell carries NO class of its own — `.mstrip>div` is what styles it.
    expect([...strip.children].every((c) => c.getAttribute("class") === null)).toBe(true)
  })

  it("emits k, v, d, blt, band — the prototype's order", () => {
    const { container } = render(
      <MStrip
        cells={[
          {
            label: "Labor",
            value: "24.8%",
            delta: "on plan",
            deltaTone: "is-flat",
            caption: "band 23.9–26.2%",
            reference: BAND,
          },
        ]}
      />,
    )
    expect(shapeOf(container.querySelector(".mstrip")!.firstElementChild!)).toEqual([
      "span.k",
      "span.v",
      "span.d.is-flat",
      "span.blt",
      "span.band",
    ])
  })

  it("draws NO sparkline, even when the reference carries a series", () => {
    // The prototype's own comment: "The phone takes the mark but not the
    // trajectory: the two charts are directly beneath it and vertical space is
    // the scarce thing here." `Figure` would emit one; this must not.
    const { container } = render(
      <MStrip
        cells={[
          { label: "Orders", value: "1,284", reference: { ...BAND, series: [1, 2, 3, 4, 5] } },
        ]}
      />,
    )
    expect(container.querySelector(".sp")).toBeNull()
    expect(container.querySelector("svg")).toBeNull()
  })

  it("carries no data-n, because .mstrip has no track rule to feed", () => {
    // `.strip` is a six-track grid overridden per data-n; `.mstrip` is
    // `grid-template-columns:1fr 1fr` and nothing else. An attribute the sheet
    // does not read is one the fidelity gate reports as a difference.
    const { container } = render(
      <MStrip cells={[{ label: "A", value: "1" }, { label: "B", value: "2" }]} />,
    )
    expect(container.querySelector(".mstrip")!.hasAttribute("data-n")).toBe(false)
  })

  it("draws a bullet only when the reference is judged", () => {
    const { container } = render(
      <MStrip
        cells={[
          { label: "Food cost", value: "30.9%", reference: { v: 30.9, target: 28.5, better: "low" } },
          { label: "Prime cost", value: "56.2%" },
        ]}
      />,
    )
    expect(container.querySelectorAll(".blt")).toHaveLength(1)
  })

  it("opens no band at all for a caption with no reference", () => {
    // `Figure`'s band opens on `caption || reference`. `mstrip()`'s whole band
    // branch lives inside `r ? … : ''`, so a caption alone draws nothing.
    const { container } = render(
      <MStrip cells={[{ label: "Prime cost", value: "56.2%", caption: "3.8 pts of room" }]} />,
    )
    expect(container.querySelector(".band")).toBeNull()
  })

  it("opens a band with the caption alone when the reference is unjudged", () => {
    const { container } = render(
      <MStrip
        cells={[
          {
            label: "Marketplace fees",
            value: "$1,204",
            caption: "no published band",
            reference: { v: 1204, better: "low" },
          },
        ]}
      />,
    )
    const band = container.querySelector(".band")!
    expect(band.textContent).toBe("no published band")
    expect(band.querySelector(".flag")).toBeNull()
  })

  it("says the word in front of the caption when a figure breaches", () => {
    const { container } = render(
      <MStrip
        cells={[
          {
            label: "Food cost",
            value: "30.9%",
            caption: "plan 28.5%",
            reference: { v: 30.9, target: 28.5, better: "low" },
          },
        ]}
      />,
    )
    const flag = container.querySelector(".band .flag")!
    expect(flag.className).toBe("flag is-breach")
    expect(flag.textContent).toBe("over")
    expect(container.querySelector(".band")!.textContent).toBe("over plan 28.5%")
  })

  it("draws the meter and says nothing when the reference is quiet", () => {
    const { container } = render(
      <MStrip
        cells={[{ label: "Labor", value: "24.8%", caption: "band 23.9–26.2%", reference: { ...BAND, v: 27, quiet: true } }]}
      />,
    )
    expect(container.querySelector(".blt")).not.toBeNull()
    expect(container.querySelector(".flag")).toBeNull()
  })

  it("omits .d when a cell has no delta, rather than printing an empty span", () => {
    // The prototype's `c[2] ? … : ''` — and Overview's phone strip passes '' on
    // every cell when the comparison is off.
    const { container } = render(<MStrip cells={[{ label: "Orders", value: "1,284" }]} />)
    expect(container.querySelector(".d")).toBeNull()
  })
})
