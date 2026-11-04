// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DateControl } from "@/components/counter/shell/date-control"

const range = { start: new Date(2026, 7, 15), end: new Date(2026, 7, 21) }
const props = {
  presetId: "d7" as const,
  comparisonId: "weekday" as const,
  range,
  onPreset: () => {},
  onComparison: () => {},
  onRange: () => {},
}

// NOTE on `fireEvent` vs raw `.click()`: under React 19 + @testing-library/react
// 16 + jsdom, a raw `element.click()` invokes the handler synchronously but the
// resulting setState does NOT commit to the DOM before the next synchronous
// line; only `fireEvent` (act-wrapped) flushes in time for an assertion right
// after it.
describe("DateControl", () => {
  it("has a TWO-LINE trigger: the dates over the preset and the comparison", () => {
    // The old control printed "Last 7 days" and hid the actual dates, so the
    // one thing every figure on the page is a claim about was not on screen.
    const { container } = render(<DateControl {...props} />)
    const main = container.querySelector(".dr__main") as HTMLElement
    expect(main.querySelector(".lb")?.textContent).toBe("Aug 15 – Aug 21")
    expect(main.querySelector(".cmp")?.textContent).toBe("Last 7 days · vs 4 weekdays")
  })

  it('names a custom range by its ends, and calls the preset line "Custom range"', () => {
    const { container } = render(
      <DateControl {...props} presetId="custom" range={{ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }} />,
    )
    const main = container.querySelector(".dr__main") as HTMLElement
    expect(main.querySelector(".lb")?.textContent).toBe("Aug 3 – Aug 9")
    // Aug 3 – 9 2026 is Monday to Sunday, so the second line names the week.
    expect(main.querySelector(".cmp")?.textContent).toContain("Week of Aug 3")
  })

  it('calls a window no shape names "Custom range"', () => {
    const { container } = render(
      <DateControl {...props} presetId="custom" range={{ start: new Date(2026, 7, 4), end: new Date(2026, 7, 9) }} />,
    )
    expect(container.querySelector(".dr__main .cmp")?.textContent).toContain("Custom range")
  })

  it("has a Today button, outside the stepper group", () => {
    const onPreset = vi.fn()
    const { container } = render(<DateControl {...props} onPreset={onPreset} />)
    const today = container.querySelector(".dr__today") as HTMLElement
    expect(today.textContent).toBe("Today")
    fireEvent.click(today)
    expect(onPreset).toHaveBeenCalledWith("today")
  })

  it("keeps .drpop in the DOM and opens it with a class, exactly as the prototype does", () => {
    // `.dr.is-open .drpop{display:grid}` is the only thing that shows it. It
    // also means the Apply button inside it is a real element inside
    // `.pagehead` — which is why the fidelity gate can see a `.btn` there.
    const { container } = render(<DateControl {...props} />)
    const dr = container.querySelector(".dr") as HTMLElement
    expect(container.querySelector(".drpop")).toBeTruthy()
    expect(container.querySelector(".drpop .btn.btn--primary")).toBeTruthy()
    expect(dr.className).toBe("dr")
    fireEvent.click(container.querySelector(".dr__main") as HTMLElement)
    expect(dr.className).toBe("dr is-open")
  })

  it("shows the menu presets in four groups, each with its own day count", () => {
    const { container } = render(<DateControl {...props} />)
    expect([...container.querySelectorAll(".drpop__grp > .drpop__k")].map((k) => k.textContent)).toEqual([
      "Days", "Weeks", "Months", "Longer",
    ])
    const presets = [...container.querySelectorAll(".drp")]
    expect(presets).toHaveLength(10)
    for (const p of presets) expect(p.querySelector(".n")?.textContent).toMatch(/^\d+d$/)
    const thirty = presets.find((p) => p.textContent?.startsWith("Last 30 days"))!
    expect(thirty.querySelector(".n")?.textContent).toBe("30d")
  })

  it("marks the current preset with aria-pressed, which is the selector that paints it", () => {
    const { container } = render(<DateControl {...props} />)
    const pressed = [...container.querySelectorAll(".drp")].filter(
      (p) => p.getAttribute("aria-pressed") === "true",
    )
    expect(pressed).toHaveLength(1)
    expect(pressed[0].textContent).toContain("Last 7 days")
  })

  it("checks no preset while a custom range is showing", () => {
    const { container } = render(
      <DateControl {...props} presetId="custom" range={{ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }} />,
    )
    expect(
      [...container.querySelectorAll(".drp")].filter((p) => p.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(0)
  })

  it("picks a preset, and closes", () => {
    const onPreset = vi.fn()
    const { container } = render(<DateControl {...props} onPreset={onPreset} />)
    fireEvent.click(container.querySelector(".dr__main") as HTMLElement)
    fireEvent.click([...container.querySelectorAll(".drp")].find((p) => p.textContent?.startsWith("Last month"))!)
    expect(onPreset).toHaveBeenCalledWith("lastmonth")
    expect((container.querySelector(".dr") as HTMLElement).className).toBe("dr")
  })

  it("steps a Monday week by whole weeks, through onRange", () => {
    const onRange = vi.fn()
    const week = { start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }
    const { container } = render(<DateControl {...props} presetId="custom" range={week} onRange={onRange} />)
    const steps = container.querySelectorAll(".dr__step")
    fireEvent.click(steps[0])
    const back = onRange.mock.calls[0][0] as { start: Date; end: Date }
    expect([back.start.getDate(), back.end.getDate()]).toEqual([27, 2])
    fireEvent.click(steps[1])
    const fwd = onRange.mock.calls[1][0] as { start: Date; end: Date }
    expect([fwd.start.getDate(), fwd.end.getDate()]).toEqual([10, 16])
  })

  it("steps a single day by one day", () => {
    const onRange = vi.fn()
    const day = { start: new Date(2026, 7, 5), end: new Date(2026, 7, 5) }
    const { container } = render(<DateControl {...props} presetId="custom" range={day} onRange={onRange} />)
    fireEvent.click(container.querySelectorAll(".dr__step")[0])
    expect((onRange.mock.calls[0][0] as { start: Date }).start.getDate()).toBe(4)
  })

  describe("the calendar", () => {
    it("is inside .drpop__cal > .drcals, showing the month the range ends in", () => {
      const { container } = render(<DateControl {...props} />)
      expect(container.querySelector(".drpop__cal .drcals .drgrid")).toBeTruthy()
      expect(container.querySelector(".drcal__hd b")?.textContent).toBe("August 2026")
    })

    it("shades the comparison window", () => {
      // weekday, over a 7-day range: `comparisonRange` returns Jul 18 – Aug 14,
      // so August's shaded days run 1..14.
      const { container } = render(<DateControl {...props} />)
      const shaded = [...container.querySelectorAll("button.drd.cmp")].map((b) => b.textContent)
      expect(shaded[0]).toBe("1")
      expect(shaded[shaded.length - 1]).toBe("14")
    })

    it("picks a single day in ONE tap, and closes", () => {
      // The owner's complaint: picking one day took several clicks.
      const onRange = vi.fn()
      const { container } = render(<DateControl {...props} onRange={onRange} />)
      fireEvent.click(container.querySelector(".dr__main") as HTMLElement)
      fireEvent.click([...container.querySelectorAll("button.drd")].find((b) => b.textContent === "12")!)
      expect(onRange).toHaveBeenCalledTimes(1)
      const picked = onRange.mock.calls[0][0] as { start: Date; end: Date }
      expect([picked.start.getDate(), picked.end.getDate()]).toEqual([12, 12])
      expect((container.querySelector(".dr") as HTMLElement).className).toBe("dr")
    })

    it("picks a whole Monday week from its week number", () => {
      const onRange = vi.fn()
      const { container } = render(<DateControl {...props} onRange={onRange} />)
      fireEvent.click(screen.getByRole("button", { name: "Pick the week of August 10" }))
      const picked = onRange.mock.calls[0][0] as { start: Date; end: Date }
      expect([picked.start.getDate(), picked.end.getDate()]).toEqual([10, 16])
    })

    it("in range mode, takes TWO clicks to make a range, and reports nothing on the first", () => {
      const onRange = vi.fn()
      const { container } = render(<DateControl {...props} onRange={onRange} />)
      fireEvent.click(screen.getByRole("button", { name: "A range" }))
      const day = (n: string) =>
        [...container.querySelectorAll("button.drd")].find((b) => b.textContent === n)!
      fireEvent.click(day("4"))
      expect(onRange).not.toHaveBeenCalled()
      fireEvent.click(day("9"))
      expect(onRange).toHaveBeenCalledTimes(1)
      const picked = onRange.mock.calls[0][0] as { start: Date; end: Date }
      expect([picked.start.getDate(), picked.end.getDate()]).toEqual([4, 9])
    })

    it("orders the two clicks, so picking backwards still gives a forward range", () => {
      const onRange = vi.fn()
      const { container } = render(<DateControl {...props} onRange={onRange} />)
      fireEvent.click(screen.getByRole("button", { name: "A range" }))
      const day = (n: string) =>
        [...container.querySelectorAll("button.drd")].find((b) => b.textContent === n)!
      fireEvent.click(day("9"))
      fireEvent.click(day("4"))
      const picked = onRange.mock.calls[0][0] as { start: Date; end: Date }
      expect([picked.start.getDate(), picked.end.getDate()]).toEqual([4, 9])
    })

    it("walks months without touching the range", () => {
      const onRange = vi.fn()
      const { container } = render(<DateControl {...props} onRange={onRange} />)
      fireEvent.click(screen.getByRole("button", { name: /previous month/i }))
      expect(container.querySelector(".drcal__hd b")?.textContent).toBe("July 2026")
      expect(onRange).not.toHaveBeenCalled()
    })
  })

  describe(".drpop__foot", () => {
    it("offers the comparisons as a .drcmp group, pressed on the current one", () => {
      const { container } = render(<DateControl {...props} />)
      const buttons = [...container.querySelectorAll(".drcmp button")]
      expect(buttons).toHaveLength(4)
      const pressed = buttons.filter((b) => b.getAttribute("aria-pressed") === "true")
      expect(pressed.map((b) => b.textContent)).toEqual(["4 same weekdays"])
    })

    it("does NOT offer the weekday comparison on a long range", () => {
      // comparisonRange returns null past 7 days. A control that offered it
      // would render an empty comparison, which reads as "no change" rather
      // than "that question does not apply here".
      const { container } = render(
        <DateControl
          {...props}
          presetId="d30"
          comparisonId="prev"
          range={{ start: new Date(2026, 6, 23), end: new Date(2026, 7, 21) }}
        />,
      )
      const buttons = [...container.querySelectorAll(".drcmp button")]
      expect(buttons).toHaveLength(3)
      expect(buttons.map((b) => b.textContent).join(" ")).not.toMatch(/weekday/i)
    })

    it("names the bucket size and the span the page is actually reading", () => {
      const { container } = render(<DateControl {...props} />)
      const labels = [...container.querySelectorAll(".drpop__foot .lbl")].map((l) => l.textContent)
      expect(labels).toContain("day buckets · 7 days")
    })

    it("buckets by week once the span outruns a month", () => {
      const { container } = render(
        <DateControl {...props} presetId="d90" range={{ start: new Date(2026, 4, 24), end: new Date(2026, 7, 21) }} />,
      )
      const labels = [...container.querySelectorAll(".drpop__foot .lbl")].map((l) => l.textContent)
      expect(labels).toContain("week buckets · 90 days")
    })

    it("says which dates the comparison reads", () => {
      const { container } = render(
        <DateControl {...props} presetId="custom" comparisonId="prev" range={{ start: new Date(2026, 7, 3), end: new Date(2026, 7, 4) }} />,
      )
      expect(container.querySelector(".drcmpline")?.textContent).toBe("Comparing Aug 3 – Aug 4 with Jul 27 – Jul 28.")
    })

    it("Done only closes — every choice has already been reported", () => {
      const onRange = vi.fn()
      const onPreset = vi.fn()
      const { container } = render(<DateControl {...props} onRange={onRange} onPreset={onPreset} />)
      fireEvent.click(container.querySelector(".dr__main") as HTMLElement)
      fireEvent.click(container.querySelector(".drpop .btn--primary") as HTMLElement)
      expect((container.querySelector(".dr") as HTMLElement).className).toBe("dr")
      expect(onRange).not.toHaveBeenCalled()
      expect(onPreset).not.toHaveBeenCalled()
    })
  })

  it("closes on Escape without choosing anything", () => {
    const onPreset = vi.fn()
    const { container } = render(<DateControl {...props} onPreset={onPreset} />)
    const dr = container.querySelector(".dr") as HTMLElement
    fireEvent.click(container.querySelector(".dr__main") as HTMLElement)
    expect(dr.className).toBe("dr is-open")
    fireEvent.keyDown(document, { key: "Escape" })
    expect(dr.className).toBe("dr")
    expect(onPreset).not.toHaveBeenCalled()
  })

  it("closes on an outside click without choosing anything", () => {
    const { container } = render(<DateControl {...props} />)
    const dr = container.querySelector(".dr") as HTMLElement
    fireEvent.click(container.querySelector(".dr__main") as HTMLElement)
    fireEvent.mouseDown(document.body)
    expect(dr.className).toBe("dr")
  })
})
