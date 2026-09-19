// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Calendar } from "@/components/counter/shell/calendar"
import { comparisonWindows } from "@/lib/counter/date-range"

// August 2026: the 1st is a Saturday, so a Monday-start grid needs FIVE
// lead-in blanks. That is the arithmetic `(first.getDay() + 6) % 7` does, and
// getting it wrong shifts every date in the month by a column.
const august = new Date(2026, 7, 1)
const range = { start: new Date(2026, 7, 15), end: new Date(2026, 7, 21) }
const today = new Date(2026, 7, 21)

function draw(props: Partial<Parameters<typeof Calendar>[0]> = {}) {
  return render(
    <Calendar
      month={august}
      range={range}
      compare={null}
      today={today}
      onPickDay={() => {}}
      onMonthChange={() => {}}
      {...props}
    />,
  )
}

describe("Calendar", () => {
  it("is the prototype's cal(): a .drcal__hd over a .drgrid", () => {
    const { container } = draw()
    expect(container.querySelector(".drcal__hd b")?.textContent).toBe("August 2026")
    expect(container.querySelectorAll(".drgrid .dw")).toHaveLength(7)
  })

  it("starts the week on Monday and leads in with .drd.out blanks", () => {
    const { container } = draw()
    expect([...container.querySelectorAll(".dw")].map((d) => d.textContent)).toEqual([
      "M", "T", "W", "T", "F", "S", "S",
    ])
    expect(container.querySelectorAll(".drd.out")).toHaveLength(5)
    expect(container.querySelectorAll("button.drd")).toHaveLength(31)
  })

  it("marks the range with .in and its two ends with .edge", () => {
    const { container } = draw()
    const inRange = [...container.querySelectorAll("button.drd.in")].map((b) => b.textContent)
    expect(inRange).toEqual(["15", "16", "17", "18", "19", "20", "21"])
    const edges = [...container.querySelectorAll("button.drd.edge")].map((b) => b.textContent)
    expect(edges).toEqual(["15", "21"])
  })

  it("dots today, wherever it falls", () => {
    const { container } = draw()
    const marked = [...container.querySelectorAll("button.drd.today")].map((b) => b.textContent)
    expect(marked).toEqual(["21"])
  })

  it("shades the windows the page ACTUALLY compares against", () => {
    // `comparisonWindows(range, "prev")` for Aug 15–21 is one window, Aug
    // 8–14. The shading is drawn from the same function the figures are
    // computed from, so the calendar cannot disagree with the deltas above it.
    const compare = comparisonWindows(range, "prev")
    const { container } = draw({ compare })
    const shaded = [...container.querySelectorAll("button.drd.cmp")].map((b) => b.textContent)
    expect(shaded).toEqual(["8", "9", "10", "11", "12", "13", "14"])
  })

  it("shades four separate weeks for a weekday comparison, not the span between them", () => {
    /*
     * Aug 15–21 is seven days, so its four occurrences tile: Jul 18 – Aug 14.
     * A SHORTER range is where the hull and the windows part company, and
     * where this used to shade days nothing was read against — see the module
     * comment.
     */
    const oneDay = { start: new Date(2026, 7, 21), end: new Date(2026, 7, 21) }
    const { container } = draw({ range: oneDay, compare: comparisonWindows(oneDay, "weekday") })
    const shaded = [...container.querySelectorAll("button.drd.cmp")].map((b) => b.textContent)
    // Aug 21 2026 is a Friday; its four preceding Fridays are Jul 24, Jul 31,
    // Aug 7 and Aug 14, of which this grid draws the two in August. The
    // eighteen days BETWEEN them are the point: the hull would have shaded
    // Aug 1–14 solid.
    expect(shaded).toEqual(["7", "14"])
  })

  it("shades nothing when the comparison is off", () => {
    const { container } = draw({ compare: comparisonWindows(range, "none") })
    expect(container.querySelectorAll("button.drd.cmp")).toHaveLength(0)
  })

  it("shows the half-finished pick as an edge, so the first click is visible", () => {
    const { container } = draw({ pending: new Date(2026, 7, 4) })
    const four = [...container.querySelectorAll("button.drd")].find((b) => b.textContent === "4")!
    expect(four.className).toContain("in")
    expect(four.className).toContain("edge")
  })

  it("reports the day it was given, as a real Date", () => {
    const onPickDay = vi.fn()
    const { container } = draw({ onPickDay })
    const nine = [...container.querySelectorAll("button.drd")].find((b) => b.textContent === "9")!
    fireEvent.click(nine)
    expect(onPickDay).toHaveBeenCalledTimes(1)
    const picked = onPickDay.mock.calls[0][0] as Date
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([2026, 7, 9])
  })

  it("walks a month at a time, in both directions", () => {
    const onMonthChange = vi.fn()
    draw({ onMonthChange })
    fireEvent.click(screen.getByRole("button", { name: /previous month/i }))
    expect((onMonthChange.mock.calls[0][0] as Date).getMonth()).toBe(6)
    fireEvent.click(screen.getByRole("button", { name: /next month/i }))
    expect((onMonthChange.mock.calls[1][0] as Date).getMonth()).toBe(8)
  })

  it("names each day for a screen reader, where the prototype prints a bare number", () => {
    draw()
    expect(screen.getByRole("button", { name: "Friday, August 21, 2026" })).toBeTruthy()
  })
})
