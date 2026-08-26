// @vitest-environment jsdom
/**
 * `MHead` against the prototype's own `.mhead`, emitted inline inside
 * `P.overview.phone()` (`docs/counter/counter-prototype.html` line 4369).
 *
 * These tests are about DOM: class names, element order, and the classes the
 * ported stylesheet actually has a rule for. A class the sheet does not style
 * is the `Meter` defect Phase B found — a component that existed, was
 * exported, was used, and was invisible to the design system.
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MHead } from "@/components/counter/shell/m-head"

const SHEET = readFileSync(join(process.cwd(), "src/styles/counter-components.css"), "utf8")

/** The tag/class sequence of an element's direct children, in document order. */
function shapeOf(el: Element): string[] {
  return [...el.children].map((c) => {
    const cls = c.getAttribute("class")
    return cls ? `${c.tagName.toLowerCase()}.${cls.split(/\s+/).join(".")}` : c.tagName.toLowerCase()
  })
}

describe("MHead — the phone's head block", () => {
  it("emits .mhead, and k then v, for a bare head", () => {
    const { container } = render(<MHead label="Net sales today" value="$25,879" />)
    const head = container.firstElementChild!
    expect(head.className).toBe("mhead")
    expect(shapeOf(head)).toEqual(["span.k", "span.v"])
  })

  it("emits k, v, d, then the sentence — the prototype's order", () => {
    const { container } = render(
      <MHead
        label="Net sales · 7 days"
        value="$25,879"
        delta="▲ 4.1% vs the same 4 weekdays"
        note={<p>Food cost is 30.9% against a 28.5% plan.</p>}
      />,
    )
    expect(shapeOf(container.firstElementChild!)).toEqual([
      "span.k",
      "span.v",
      "span.d",
      "p",
    ])
  })

  it("marks the value so a figure can be found without reading its text", () => {
    const { container } = render(<MHead label="Net sales" value="$25,879" />)
    expect(container.querySelector("[data-figure-value]")?.className).toBe("v")
  })

  it("omits .d entirely when there is no comparison, rather than printing an empty span", () => {
    // Note 19 cuts both ways: an empty delta beside "with no comparison set"
    // is a box on the page saying nothing.
    const { container } = render(<MHead label="Net sales" value="$25,879" />)
    expect(container.querySelector(".d")).toBeNull()
  })

  it("paints a fall as a fall, and only because the sheet now has a rule for one", () => {
    // This test used to assert the OPPOSITE — that `.mhead .d` never carries a
    // tone — because the prototype gives it one rule, `color:var(--good)`, and
    // a class matching no rule is the `Meter` defect. The consequence was
    // visible in the browser: net sales down 37.2% printed its ▼ in the colour
    // of a rise. The sheet was corrected instead (an entry in
    // `scripts/extract-prototype-css.ts`'s CORRECTIONS table, covering
    // `.mhead .d` and `.headline .d` together), so the class is now live.
    //
    // The sheet assertion stays: a tone class is only ever emitted here
    // because there is a rule to receive it.
    expect(SHEET).toMatch(/\.mhead \.d\.is-down\{color:var\(--bad\)\}/)
    expect(SHEET).toMatch(/\.mhead \.d\.is-flat\{color:var\(--ink-3\)\}/)

    const { container } = render(
      <MHead
        label="Net sales"
        value="$25,879"
        delta="▼ 37.2% vs the prior period"
        deltaTone="is-down"
      />,
    )
    expect(container.querySelector(".d")!.className).toBe("d is-down")
  })

  it("never infers the tone from the arrow it was handed", () => {
    // `.is-down` is SENTIMENT, not direction — the prototype puts it on a rise
    // (`mkt.d > 0`) and on a fall (`rep.d < 0`) on the same page. A component
    // that read the ▼ would paint every fall red, including the ones that are
    // wins (marketplace fees). The caller decides; unclassed reads as a rise.
    const { container } = render(
      <MHead label="Marketplace fees" value="$684" delta="▼ 12.0% vs the prior period" />,
    )
    expect(container.querySelector(".d")!.className).toBe("d")
  })

  it("renders the sentence as given, so a Section's own state div is legal here", () => {
    // Every non-ready `Section` rendering is a <div>, and a <div> inside a <p>
    // does not hydrate. `note` is therefore a direct grid child and the caller
    // owns the <p>.
    const { container } = render(
      <MHead label="Net sales" value="$0" note={<div className="failed">The verdict unavailable</div>} />,
    )
    const head = container.firstElementChild!
    expect(head.querySelector("p")).toBeNull()
    expect(shapeOf(head)).toEqual(["span.k", "span.v", "div.failed"])
  })

  it("prints the label and the figure as text a reader gets", () => {
    render(<MHead label="Build-out" value="No date set" />)
    expect(screen.getByText("Build-out").className).toBe("k")
    expect(screen.getByText("No date set").className).toBe("v")
  })
})
