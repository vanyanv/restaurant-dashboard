// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Meter } from "@/components/counter/surface/meter"

describe("Meter", () => {
  it("draws the reference line where the target sits", () => {
    const { container } = render(
      <Meter label="Prime cost" value={0.562} reference={0.6} max={1} format="56.2%" />,
    )
    const ref = container.querySelector("[data-meter-reference]") as HTMLElement
    expect(ref.style.left).toBe("60%")
  })

  it("under the reference, nothing is coloured as a breach", () => {
    const { container } = render(
      <Meter label="Prime cost" value={0.562} reference={0.6} max={1} format="0.562" />,
    )
    expect(container.querySelector("[data-meter-overshoot]")).toBeNull()
  })

  it("over the reference, ONLY the distance past it is coloured", () => {
    const { container } = render(
      <Meter label="Prime cost" value={0.65} reference={0.6} max={1} format="0.65" />,
    )
    const over = container.querySelector("[data-meter-overshoot]") as HTMLElement
    expect(over).toBeTruthy()
    // 0.65 - 0.60 = 0.05 of a max of 1 → 5% wide, starting at the reference.
    expect(over.style.width).toBe("5%")
    expect(over.style.left).toBe("60%")
    // the measure itself is NOT painted as bad — note 35
    expect((container.querySelector("[data-meter-fill]") as HTMLElement).className)
      .not.toMatch(/bg-ct-bad\b/)
  })

  it("takes pre-formatted strings, not a formatting function, consistent with Figure.value", () => {
    render(<Meter label="Prime cost" value={0.562} reference={0.6} max={1} format="56.2%" target="60.0%" />)
    expect(screen.getByText("56.2%")).toBeTruthy()
    expect(screen.getByText(/target 60\.0%/)).toBeTruthy()
  })

  it("target falls back to format when not given separately", () => {
    render(<Meter label="Prime cost" value={0.562} reference={0.6} max={1} format="56.2%" />)
    expect(screen.getByText(/target 56\.2%/)).toBeTruthy()
  })

  it("a zero max cannot divide-by-zero into NaN%/Infinity% — every width collapses to 0%", () => {
    const { container } = render(
      <Meter label="Labor $" value={500} reference={800} max={0} format="$500" />,
    )
    const fill = container.querySelector("[data-meter-fill]") as HTMLElement
    const ref = container.querySelector("[data-meter-reference]") as HTMLElement
    expect(fill.style.width).toBe("0%")
    expect(ref.style.left).toBe("0%")
    expect(fill.style.width).not.toMatch(/NaN|Infinity/)
  })

  it("a value far past max is clamped to a 100% width, and the track clips overflow too", () => {
    const { container } = render(
      <Meter label="Cost" value={300} reference={100} max={100} format="$300" />,
    )
    const over = container.querySelector("[data-meter-overshoot]") as HTMLElement
    // raw ratio would be (300-100)/100 = 200% — clamped to 100%
    expect(over.style.width).toBe("100%")
    const track = container.querySelector("[data-meter-fill]")!.parentElement as HTMLElement
    expect(track.className).toMatch(/overflow-hidden/)
  })

  it("a negative value does not produce a negative width", () => {
    const { container } = render(
      <Meter label="Delta" value={-10} reference={5} max={100} format="-10" />,
    )
    const fill = container.querySelector("[data-meter-fill]") as HTMLElement
    expect(fill.style.width).toBe("0%")
    expect(fill.style.width).not.toMatch(/^-/)
  })
})
