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
    // React serialises an inline style object as "width: 0%;" (space after
    // the colon, trailing semicolon) — the brief's assertion text ("width:0%")
    // does not match what `style={{ width: ... }}` ever renders.
    expect(wed.querySelector(".bar i")?.getAttribute("style")).toContain("width: 0%")
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

  // A bar wider than its track reads as "beat forecast by a lot" no matter how
  // far past 100 it goes, and overflows the cell.
  it("clamps the bar at 100%", () => {
    const { container } = render(
      <WeekPicker days={[{ key: "d", label: "Sat", forecast: 100, actual: 400 }]} selected="d" onSelect={() => {}} />,
    )
    expect(container.querySelector(".bar i")?.getAttribute("style")).toContain("width: 100%")
  })

  // Guarding the division, not the display: a zero forecast is a real state
  // for a store that is not trading yet.
  it("does not divide by a zero forecast", () => {
    const { container } = render(
      <WeekPicker days={[{ key: "d", label: "Sat", forecast: 0, actual: 500 }]} selected="d" onSelect={() => {}} />,
    )
    expect(container.querySelector(".bar i")?.getAttribute("style")).toContain("width: 0%")
  })
})
