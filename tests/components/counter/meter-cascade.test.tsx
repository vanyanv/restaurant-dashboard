// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Meter } from "@/components/counter/surface/meter"
import { Cascade } from "@/components/counter/surface/cascade"

describe("Meter", () => {
  it("draws the reference line where the target sits", () => {
    const { container } = render(
      <Meter label="Prime cost" value={0.562} reference={0.6} max={1} format={(v) => `${(v * 100).toFixed(1)}%`} />,
    )
    const ref = container.querySelector("[data-meter-reference]") as HTMLElement
    expect(ref.style.left).toBe("60%")
  })

  it("under the reference, nothing is coloured as a breach", () => {
    const { container } = render(
      <Meter label="Prime cost" value={0.562} reference={0.6} max={1} format={(v) => `${v}`} />,
    )
    expect(container.querySelector("[data-meter-overshoot]")).toBeNull()
  })

  it("over the reference, ONLY the distance past it is coloured", () => {
    const { container } = render(
      <Meter label="Prime cost" value={0.65} reference={0.6} max={1} format={(v) => `${v}`} />,
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

  it("a zero max cannot divide-by-zero into NaN%/Infinity% — every width collapses to 0%", () => {
    const { container } = render(
      <Meter label="Labor $" value={500} reference={800} max={0} format={(v) => `$${v}`} />,
    )
    const fill = container.querySelector("[data-meter-fill]") as HTMLElement
    const ref = container.querySelector("[data-meter-reference]") as HTMLElement
    expect(fill.style.width).toBe("0%")
    expect(ref.style.left).toBe("0%")
    expect(fill.style.width).not.toMatch(/NaN|Infinity/)
  })

  it("a value far past max is clamped to a 100% width, and the track clips overflow too", () => {
    const { container } = render(
      <Meter label="Cost" value={300} reference={100} max={100} format={(v) => `$${v}`} />,
    )
    const over = container.querySelector("[data-meter-overshoot]") as HTMLElement
    // raw ratio would be (300-100)/100 = 200% — clamped to 100%
    expect(over.style.width).toBe("100%")
    const track = container.querySelector("[data-meter-fill]")!.parentElement as HTMLElement
    expect(track.className).toMatch(/overflow-hidden/)
  })

  it("a negative value does not produce a negative width", () => {
    const { container } = render(
      <Meter label="Delta" value={-10} reference={5} max={100} format={(v) => `${v}`} />,
    )
    const fill = container.querySelector("[data-meter-fill]") as HTMLElement
    expect(fill.style.width).toBe("0%")
    expect(fill.style.width).not.toMatch(/^-/)
  })
})

describe("Cascade", () => {
  const steps = [
    { label: "Sales (ex-tax)", amount: 6972.89, kind: "start" as const },
    { label: "COGS", amount: -1973.9, kind: "subtract" as const },
    { label: "Labor", amount: -883.37, kind: "subtract" as const },
    { label: "Net profit", amount: 2002.71, kind: "end" as const },
  ]

  it("renders a bar per step", () => {
    const { container } = render(<Cascade steps={steps} />)
    expect(container.querySelectorAll("[data-cascade-step]")).toHaveLength(4)
  })

  it("shows what is LEFT after each subtraction, not the size of the subtraction", () => {
    const { container } = render(<Cascade steps={steps} />)
    const bars = container.querySelectorAll("[data-cascade-remaining]")
    // after COGS: 6972.89 - 1973.90 = 4998.99 of 6972.89 → ~71.7%
    expect((bars[1] as HTMLElement).style.width).toBe("71.7%")
  })

  it("labels every step with its own amount", () => {
    render(<Cascade steps={steps} />)
    expect(screen.getByText("Sales (ex-tax)")).toBeTruthy()
    expect(screen.getByText("Net profit")).toBeTruthy()
  })

  it("a zero-revenue start (closed store, empty channel filter) does not divide into NaN%/Infinity%", () => {
    const zeroSteps = [
      { label: "Sales (ex-tax)", amount: 0, kind: "start" as const },
      { label: "COGS", amount: 0, kind: "subtract" as const },
      { label: "Net profit", amount: 0, kind: "end" as const },
    ]
    const { container } = render(<Cascade steps={zeroSteps} />)
    const bars = container.querySelectorAll("[data-cascade-remaining]")
    for (const bar of Array.from(bars)) {
      const width = (bar as HTMLElement).style.width
      expect(width).toBe("0%")
      expect(width).not.toMatch(/NaN|Infinity/)
    }
  })

  it("track clips overflow so a remaining figure past start can't paint outside the bar", () => {
    const { container } = render(<Cascade steps={steps} />)
    const track = container.querySelector("[data-cascade-remaining]")!.parentElement as HTMLElement
    expect(track.className).toMatch(/overflow-hidden/)
  })
})
