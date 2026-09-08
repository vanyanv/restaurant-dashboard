// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WeekPicker } from "@/components/counter"

const WEEK = [
  { key: "2026-08-24", label: "Mon 24", forecast: 6609, actual: 7522 },
  { key: "2026-08-25", label: "Tue 25", forecast: 6200, actual: 5800 },
  { key: "2026-08-26", label: "Wed 26", forecast: 6269, actual: null },
]

describe("WeekPicker", () => {
  it("renders one .wkd per day inside a single .wk", () => {
    const { container } = render(<WeekPicker days={WEEK} selected="2026-08-26" onSelect={() => {}} />)
    expect(container.querySelectorAll(".wk")).toHaveLength(1)
    expect(container.querySelectorAll(".wkd")).toHaveLength(3)
  })

  it("marks a day that beat 97% of forecast as a hit, and one that missed as a miss", () => {
    const { container } = render(<WeekPicker days={WEEK} selected="2026-08-26" onSelect={() => {}} />)
    const cells = container.querySelectorAll(".wkd")
    expect(cells[0].className).toContain("is-hit")
    expect(cells[1].className).toContain("is-miss")
  })

  // The day still ahead is the one this is really about. A day with no actual
  // is neither a hit nor a miss, and calling it a miss would paint every
  // future day red every morning.
  it("leaves a day with no actual unmarked, and labels it forecast", () => {
    const { container } = render(<WeekPicker days={WEEK} selected="2026-08-24" onSelect={() => {}} />)
    const wed = container.querySelectorAll(".wkd")[2]
    expect(wed.className).not.toContain("is-hit")
    expect(wed.className).not.toContain("is-miss")
    expect(wed.querySelector(".av")?.textContent).toBe("forecast")
    // No band on this fixture, so the cell draws an EMPTY `.iv` rather than a
    // full-width one. An interval of unknown width drawn as if it spanned the
    // week is a claim nothing made.
    expect(wed.querySelector(".iv")).toBeTruthy()
    expect(wed.querySelector(".iv .span")).toBeNull()
  })

  it("marks exactly one day selected", () => {
    const { container } = render(<WeekPicker days={WEEK} selected="2026-08-25" onSelect={() => {}} />)
    const sel = container.querySelectorAll(".wkd.is-sel")
    expect(sel).toHaveLength(1)
    expect(sel[0].querySelector(".dn")?.textContent).toBe("Tue 25")
  })

  // The brief specified `@testing-library/user-event` here; it is not a
  // dependency of this project (not in package.json, not in node_modules) and
  // no other test in the tree uses it — the established convention, e.g.
  // tests/components/counter/queue.test.tsx, is `fireEvent.click` from
  // `@testing-library/react`. Using that instead of adding a new dependency
  // for one click.
  it("reports the day key that was pressed", () => {
    const onSelect = vi.fn()
    render(<WeekPicker days={WEEK} selected="2026-08-24" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole("button", { name: /Tue 25/ }))
    expect(onSelect).toHaveBeenCalledWith("2026-08-25")
  })

  /*
   * THE BAR IS THE INTERVAL NOW, not a fill of actual ÷ forecast.
   *
   * The three assertions this replaced were about that fill: clamping it at
   * 100%, and not dividing by a zero forecast. Both were guarding arithmetic
   * that no longer happens — see the component's own note for why the fill
   * went (on four cells out of seven there is no actual, so four bars were
   * empty while the 80% band sat on file undrawn).
   */
  const BANDED = [
    { key: "a", label: "Mon 24", forecast: 6600, actual: null, p10: 6000, p90: 7200 },
    { key: "b", label: "Tue 25", forecast: 6200, actual: null, p10: 5000, p90: 8000 },
  ]

  it("draws each day's band against ONE scale, so widths compare cell to cell", () => {
    const { container } = render(<WeekPicker days={BANDED} selected="a" onSelect={() => {}} />)
    const spans = container.querySelectorAll(".iv .span")
    expect(spans).toHaveLength(2)
    const width = (el: Element) =>
      Number(/width: ([\d.]+)%/.exec(el.getAttribute("style") ?? "")?.[1] ?? "0")
    // Tue's band is 3000 wide against Mon's 1200. If each cell scaled itself
    // the two would render the same width, which is the whole failure mode.
    expect(width(spans[1])).toBeGreaterThan(width(spans[0]) * 2)
  })

  it("marks the point inside the band, and says the band out loud to a screen reader", () => {
    const { container } = render(<WeekPicker days={BANDED} selected="a" onSelect={() => {}} />)
    const mon = container.querySelectorAll(".wkd")[0]
    expect(mon.querySelector(".iv .pt")).toBeTruthy()
    expect(mon.getAttribute("aria-label")).toContain("80% interval")
  })

  // A settled day keeps the band it was given BEFOREHAND. That is what makes
  // a kept call checkable rather than quietly rewritten after the fact.
  it("keeps a settled day's band and marks where it actually landed", () => {
    const { container } = render(
      <WeekPicker
        days={[{ key: "d", label: "Sat", forecast: 6000, actual: 5000, p10: 5500, p90: 6500 }]}
        selected="d"
        onSelect={() => {}}
      />,
    )
    const cell = container.querySelector(".wkd")!
    expect(cell.className).toContain("is-miss")
    expect(cell.querySelector(".iv .span")).toBeTruthy()
  })
})
