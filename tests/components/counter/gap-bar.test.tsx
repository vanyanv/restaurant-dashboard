// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { GapBar, type GapCause } from "@/components/counter/surface/gap-bar"

const BEEF: GapCause = {
  name: "Ground beef",
  points: 1.4,
  tone: "gp-1",
  why: "$4.12 → $4.86 a pound over 21 days",
}
const MIX: GapCause = {
  name: "Channel mix",
  points: 0.7,
  tone: "gp-2",
  why: "DoorDash at 28.9% of volume against 24.1% before",
}
const RESIDUAL = {
  name: "Everything else",
  tone: "gp-3" as const,
  why: "no single cause above 0.1 pts",
}

function widths(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".gap__bar i")).map(
    (i) => (i as HTMLElement).style.width,
  )
}

function swatches(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".gap__key > div")).map((d) => ({
    name: d.querySelector("dt")!.textContent,
    background: (d.querySelector("dt i") as HTMLElement).style.background,
    figure: d.querySelector("dd")!.textContent,
  }))
}

describe("GapBar", () => {
  it("emits the prototype's DOM: .gap > .gap__ends + .gap__bar + .gap__key + .gap__sum", () => {
    const { container } = render(
      <GapBar plan={29} actual={31.4} rangeLabel="Aug 1 – Aug 24" causes={[BEEF, MIX]} residual={RESIDUAL} />,
    )
    expect(container.querySelector(".gap > .gap__ends")).toBeTruthy()
    expect(container.querySelector(".gap > .gap__bar")).toBeTruthy()
    expect(container.querySelector("dl.gap__key")).toBeTruthy()
    expect(container.querySelector("p.gap__sum")).toBeTruthy()
    expect(container.querySelector(".gap__ends .mid")!.textContent).toBe("2.4 points over")
    expect(container.querySelector(".gap__ends .hi em")!.textContent).toBe("Aug 1 – Aug 24")
  })

  it("DERIVES the residual — the parts always add to the gap they explain", () => {
    const { container } = render(
      <GapBar plan={29} actual={31.4} rangeLabel="Aug" causes={[BEEF, MIX]} residual={RESIDUAL} />,
    )
    // 2.4 − (1.4 + 0.7) = 0.3
    expect(swatches(container)[2].figure).toBe("0.3 pts")
    expect(container.querySelector(".gap__sum")!.textContent).toMatch(/^1\.4 \+ 0\.7 \+ 0\.3 = 2\.4\./)
  })

  it("a missing cause lands INSIDE everything else, not outside the total", () => {
    // Drop the channel-mix cause entirely: the residual absorbs it and the
    // three still add to 2.4 — the caller cannot leave the gap unexplained.
    const { container } = render(
      <GapBar plan={29} actual={31.4} rangeLabel="Aug" causes={[BEEF]} residual={RESIDUAL} />,
    )
    expect(swatches(container)[1].figure).toBe("1.0 pts")
    expect(container.querySelector(".gap__sum")!.textContent).toMatch(/^1\.4 \+ 1\.0 = 2\.4\./)
  })

  it("a cause's colour is FIXED TO THE CAUSE — sorting by size does not repaint the bar", () => {
    const asDeclared = render(
      <GapBar plan={29} actual={31.4} rangeLabel="Aug" causes={[BEEF, MIX]} residual={RESIDUAL} />,
    )
    const before = new Map(swatches(asDeclared.container).map((s) => [s.name, s.background]))
    asDeclared.unmount()

    // The same range, one cause now larger than the other. Note 35's ramp is
    // sequential; assigning it by rank would swap two colours and tell the
    // reader a category changed.
    const grown = render(
      <GapBar
        plan={29}
        actual={31.4}
        rangeLabel="Aug"
        causes={[{ ...BEEF, points: 0.5 }, { ...MIX, points: 1.6 }]}
        residual={RESIDUAL}
      />,
    )
    const after = new Map(swatches(grown.container).map((s) => [s.name, s.background]))

    expect(after.get("Ground beef")).toBe(before.get("Ground beef"))
    expect(after.get("Channel mix")).toBe(before.get("Channel mix"))
    expect(after.get("Ground beef")).not.toBe(after.get("Channel mix"))
  })

  it("every colour is a --gp ramp step, not a literal", () => {
    const { container } = render(
      <GapBar plan={29} actual={31.4} rangeLabel="Aug" causes={[BEEF, MIX]} residual={RESIDUAL} />,
    )
    for (const s of swatches(container)) expect(s.background).toMatch(/^var\(--gp-[123]\)$/)
    for (const i of Array.from(container.querySelectorAll(".gap__bar i"))) {
      expect((i as HTMLElement).style.background).toMatch(/^var\(--gp-[123]\)$/)
    }
  })

  it("segment widths are the share of the overshoot, and they fill the bar", () => {
    const { container } = render(
      <GapBar plan={29} actual={31.4} rangeLabel="Aug" causes={[BEEF, MIX]} residual={RESIDUAL} />,
    )
    const total = widths(container).reduce((t, w) => t + Number(w.replace("%", "")), 0)
    expect(Math.round(total)).toBe(100)
  })

  it("a cause pulling the other way is REPORTED but takes no width", () => {
    const helping: GapCause = { ...MIX, points: -0.4 }
    const { container } = render(
      <GapBar plan={29} actual={31.4} rangeLabel="Aug" causes={[BEEF, helping]} residual={RESIDUAL} />,
    )
    expect(widths(container)[1]).toBe("0%")
    expect(swatches(container)[1].figure).toBe("−0.4 pts")
    // and the residual still closes the statement: 1.4 − 0.4 + 1.4 = 2.4
    expect(swatches(container)[2].figure).toBe("1.4 pts")
  })

  it("a range that came in UNDER plan says so, rather than printing a negative overshoot", () => {
    render(
      <GapBar plan={29} actual={28.2} rangeLabel="Aug" causes={[{ ...BEEF, points: -0.5 }]} residual={RESIDUAL} />,
    )
    expect(screen.getByText("0.8 points under")).toBeTruthy()
  })

  it("a gap of exactly zero does not divide by zero", () => {
    const { container } = render(
      <GapBar plan={29} actual={29} rangeLabel="Aug" causes={[{ ...BEEF, points: 0 }]} residual={RESIDUAL} />,
    )
    for (const w of widths(container)) expect(w).not.toMatch(/NaN|Infinity/)
    expect(container.querySelector(".gap__ends .mid")!.textContent).toBe("0.0 points over")
  })
})
