// @vitest-environment jsdom
/**
 * `Bullet` against `bullet()` at line 3745 of
 * `docs/counter/counter-prototype.html`. The maths is proved in
 * `tests/lib/counter/bullet-state.test.ts`; this is about the DOM the ported
 * stylesheet needs — the class names, the order, and the inline percentages
 * that are the only thing positioning the parts.
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { Bullet } from "@/components/counter/surface/bullet"
import type { Reference } from "@/lib/counter/bullet-state"

const inBand: Reference = { v: 150, lo: 100, hi: 200, better: "high", label: "Orders, in band" }
const overCeiling: Reference = { v: 300, lo: 100, hi: 200, better: "low", label: "Labour, over" }
const onTarget: Reference = { v: 1500, target: 1000, better: "high", label: "SPLH above its floor" }

function classesOf(el: Element): string[] {
  return [...el.children].map((c) => c.getAttribute("class") ?? "")
}

describe("Bullet", () => {
  it("is a `.blt` announced as an image, labelled from the reference", () => {
    const { container } = render(<Bullet reference={inBand} />)
    const blt = container.querySelector(".blt")!
    expect(blt.getAttribute("role")).toBe("img")
    expect(blt.getAttribute("aria-label")).toBe("Orders, in band")
  })

  it("labels itself with an empty string rather than nothing when the reference is unlabelled", () => {
    const { container } = render(<Bullet reference={{ v: 150, lo: 100, hi: 200, better: "high" }} />)
    expect(container.querySelector(".blt")!.getAttribute("aria-label")).toBe("")
  })

  it("draws band, fill and dot for an in-band figure, and no tick and no overrun", () => {
    const { container } = render(<Bullet reference={inBand} />)
    expect(classesOf(container.querySelector(".blt")!)).toEqual([
      "blt__band",
      "blt__fill",
      "blt__now",
    ])
  })

  it("draws tick and dot for a target, in the prototype's order", () => {
    const { container } = render(<Bullet reference={onTarget} />)
    expect(classesOf(container.querySelector(".blt")!)).toEqual([
      "blt__fill",
      "blt__tick",
      "blt__now",
    ])
  })

  it("positions every part with an inline percentage — nothing else places them", () => {
    const { container } = render(<Bullet reference={inBand} />)
    const band = container.querySelector(".blt__band") as HTMLElement
    expect(band.style.left).toBe("25%")
    expect(band.style.width).toBe("50%")
    expect((container.querySelector(".blt__fill") as HTMLElement).style.width).toBe("50%")
    expect((container.querySelector(".blt__now") as HTMLElement).style.left).toBe("50%")
  })

  it("colours only the distance past the line, and puts it after the fill", () => {
    const { container } = render(<Bullet reference={overCeiling} />)
    expect(classesOf(container.querySelector(".blt")!)).toEqual([
      "blt__band",
      "blt__fill",
      "blt__over",
      "blt__now is-breach",
    ])
    const over = container.querySelector(".blt__over") as HTMLElement
    const fill = container.querySelector(".blt__fill") as HTMLElement
    // The measure reads 300; only the 100 past the ceiling is red.
    expect(fill.style.width).toBe("75%")
    expect(over.style.left).toBe("50%")
    expect(over.style.width).toBe("25%")
  })

  it("marks the dot near, breach or neither — that is where the verdict is painted", () => {
    const near = render(<Bullet reference={{ v: 100, lo: 100, hi: 200, better: "high" }} />)
    expect(near.container.querySelector(".blt__now")!.className).toBe("blt__now is-near")

    const breach = render(<Bullet reference={overCeiling} />)
    expect(breach.container.querySelector(".blt__now")!.className).toBe("blt__now is-breach")

    const ok = render(<Bullet reference={inBand} />)
    expect(ok.container.querySelector(".blt__now")!.className).toBe("blt__now")
  })

  it("takes the prototype's `cls` as an extra class, for lead scale", () => {
    const { container } = render(<Bullet reference={inBand} className="blt--lead" />)
    expect(container.querySelector(".blt")!.className).toBe("blt blt--lead")
  })
})
