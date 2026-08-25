// @vitest-environment jsdom
/**
 * `floorMeter()` — prototype line 3793. One meter, at lead scale, plus the
 * words that say which side of the floor the figure landed on.
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { FloorMeter } from "@/components/counter/surface/floor-meter"

describe("FloorMeter", () => {
  it("is Bullet with the blt--lead modifier — not a second meter", () => {
    const { container } = render(<FloorMeter value={71.4} floor={68} />)
    const marks = container.querySelectorAll(".blt")
    expect(marks).toHaveLength(1)
    expect(marks[0].className).toBe("blt blt--lead")
    // The parts are Bullet's own, drawn from bulletGeometry — a target has a
    // tick and no band.
    expect(marks[0].querySelector(".blt__tick")).not.toBeNull()
    expect(marks[0].querySelector(".blt__band")).toBeNull()
    expect(marks[0].querySelector(".blt__now")).not.toBeNull()
  })

  it("emits the meter and the caption as SIBLINGS, with no wrapper between them and the .fig", () => {
    const { container } = render(<FloorMeter value={71.4} floor={68} />)
    // `.headline .fig` is a grid; a wrapper would take the track both of
    // these are meant to sit in.
    expect([...container.children].map((c) => c.className)).toEqual(["blt blt--lead", "hfloor"])
  })

  it("above the floor: says how much room there is, and flags nothing", () => {
    const { container } = render(<FloorMeter value={71.4} floor={68} />)
    expect(container.querySelector(".hfloor")?.textContent).toBe("Floor $68.00 · $3.40 of room")
    expect(container.querySelector(".flag")).toBeNull()
    expect(container.querySelector(".blt__now")?.className).toBe("blt__now")
  })

  it("below the floor: says how far short, and flags it under", () => {
    const { container } = render(<FloorMeter value={66.8} floor={68} />)
    expect(container.querySelector(".hfloor")?.textContent).toBe("under Floor $68.00 · $1.20 short")
    expect(container.querySelector(".flag")?.className).toBe("flag is-breach")
    expect(container.querySelector(".blt__now")?.className).toBe("blt__now is-breach")
    // The breach paints only the distance past the line, never the whole track.
    expect(container.querySelector(".blt__over")).not.toBeNull()
  })

  it("the flag and the caption cannot disagree — at the edge is still above it", () => {
    // 68.50 against a floor of 68.00: inside bstat's near zone (a tenth of
    // 12% of the target) but still over the line. One comparison decides
    // both readings, so "at the edge" and "of room" are the same fact.
    const { container } = render(<FloorMeter value={68.5} floor={68} />)
    expect(container.querySelector(".flag")?.textContent).toBe("at the edge")
    expect(container.querySelector(".hfloor")?.textContent).toBe(
      "at the edge Floor $68.00 · $0.50 of room",
    )
  })

  it("the label is the meter's only screen-reader text, and it states both numbers", () => {
    const { container } = render(<FloorMeter value={71.4} floor={68} />)
    expect(container.querySelector(".blt")?.getAttribute("aria-label")).toBe(
      "Sales per labor hour $71.40 against a floor of $68.00 — above it",
    )
    expect(
      render(<FloorMeter value={66.8} floor={68} />).container
        .querySelector(".blt")
        ?.getAttribute("aria-label"),
    ).toBe("Sales per labor hour $66.80 against a floor of $68.00 — below it")
  })

  it("takes the floor as a prop — the prototype's $68.00 is not ours to hardcode", () => {
    const { container } = render(<FloorMeter value={71.4} floor={74} />)
    expect(container.querySelector(".hfloor")?.textContent).toBe("under Floor $74.00 · $2.60 short")
  })
})
