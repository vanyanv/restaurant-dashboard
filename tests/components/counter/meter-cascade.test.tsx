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
})
