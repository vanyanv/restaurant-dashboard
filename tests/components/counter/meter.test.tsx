// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Meter } from "@/components/counter/surface/meter"

function parts(container: HTMLElement) {
  return {
    root: container.querySelector(".mtr") as HTMLElement,
    fill: container.querySelector(".mtr__f") as HTMLElement,
    tick: container.querySelector(".mtr__t") as HTMLElement | null,
  }
}

describe("Meter", () => {
  it("emits the prototype's DOM — .mtr > .mtr__f + .mtr__t — and no utilities of its own", () => {
    const { container } = render(
      <Meter value={70} lo={50} hi={90} target={80} label="Prime cost against target" />,
    )
    const { root, fill, tick } = parts(container)
    expect(root.tagName).toBe("SPAN")
    expect(root.className).toBe("mtr")
    expect(fill).toBeTruthy()
    expect(tick).toBeTruthy()
    // nothing in here is styled by a class this file invented
    expect(container.innerHTML).not.toMatch(/bg-ct-|data-meter-/)
  })

  it("positions both marks in the SHARED domain, not in the row's own range", () => {
    const { container } = render(
      <Meter value={70} lo={50} hi={90} target={80} label="l" />,
    )
    const { fill, tick } = parts(container)
    // (70 − 50) / (90 − 50) = 50%; (80 − 50) / 40 = 75%
    expect(fill.style.width).toBe("50%")
    expect(tick!.style.left).toBe("75%")
  })

  it("a column of meters shares one domain, so the same value lands in the same place", () => {
    const a = render(<Meter value={60} lo={0} hi={100} label="a" />)
    const b = render(<Meter value={60} lo={0} hi={100} label="b" />)
    expect(parts(a.container).fill.style.width).toBe(parts(b.container).fill.style.width)
  })

  it("is-over is the CALLER's judgement — the meter cannot know which side is bad", () => {
    // A sales meter UNDER its target is the bad one; a cost meter over it is.
    const under = render(<Meter value={40} lo={0} hi={100} target={80} over label="sales short" />)
    expect(parts(under.container).root.className).toBe("mtr is-over")

    const above = render(<Meter value={90} lo={0} hi={100} target={80} label="sales ahead" />)
    expect(parts(above.container).root.className).toBe("mtr")
  })

  it("no target means no tick, rather than a tick at zero", () => {
    const { container } = render(<Meter value={70} lo={50} hi={90} label="l" />)
    expect(parts(container).tick).toBeNull()
  })

  it("carries an accessible name, which the prototype's own .mtr does not", () => {
    render(<Meter value={70} lo={50} hi={90} label="Week of Aug 4, 62% of the domain" />)
    expect(screen.getByRole("img", { name: /Week of Aug 4/ })).toBeTruthy()
  })

  it("a value outside the domain is clamped rather than painted outside the track", () => {
    const over = render(<Meter value={500} lo={0} hi={100} target={200} label="l" />)
    expect(parts(over.container).fill.style.width).toBe("100%")
    expect(parts(over.container).tick!.style.left).toBe("100%")

    const under = render(<Meter value={-30} lo={0} hi={100} label="l" />)
    expect(parts(under.container).fill.style.width).toBe("0%")
    expect(parts(under.container).fill.style.width).not.toMatch(/^-/)
  })

  it("a domain with no width collapses to 0% rather than NaN%/Infinity%", () => {
    const { container } = render(<Meter value={5} lo={5} hi={5} target={5} label="l" />)
    const { fill, tick } = parts(container)
    expect(fill.style.width).toBe("0%")
    expect(tick!.style.left).toBe("0%")
    expect(fill.style.width).not.toMatch(/NaN|Infinity/)
  })
})
