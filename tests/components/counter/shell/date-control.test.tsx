// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, within, fireEvent } from "@testing-library/react"
import { DateControl } from "@/components/counter/shell/date-control"

const range = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }
const props = {
  presetId: "d7" as const,
  comparisonId: "prev" as const,
  range,
  onPreset: () => {},
  onComparison: () => {},
  onStep: () => {},
}

// NOTE on `fireEvent` vs raw `.click()`/`.dispatchEvent()`: in this repo's test
// environment (React 19 + @testing-library/react 16 + jsdom), a raw
// `element.click()` invokes the onClick handler synchronously (so a mock
// assertion right after it works fine — see task 2's StoreSwitcher tests),
// but the resulting setState does NOT commit to the DOM before the next
// synchronous line runs; only `fireEvent` (which wraps the dispatch in
// `act()`) flushes it in time for an immediately-following assertion.
// Verified directly: a bare `useState` counter's rendered text was still
// stale immediately after `button.click()` and correct immediately after
// `fireEvent.click(button)`. The brief's literal test used raw `.click()`
// for opening/closing these menus, which cannot pass here for that reason —
// every place that opens a menu and then asserts on its contents (or closes
// one via Escape and asserts it's gone) uses `fireEvent` below instead.
describe("DateControl", () => {
  it("shows the current range in words", () => {
    render(<DateControl {...props} />)
    expect(screen.getByRole("button", { name: /last 7 days/i })).toBeTruthy()
  })

  it("opens a menu offering all twelve presets", () => {
    render(<DateControl {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /last 7 days/i }))
    expect(within(screen.getByRole("menu", { name: /range/i })).getAllByRole("menuitemradio")).toHaveLength(12)
  })

  it("shows each preset's own length, so a reader picks by span not by name", () => {
    render(<DateControl {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /last 7 days/i }))
    expect(screen.getByRole("menuitemradio", { name: /last 30 days/i }).textContent).toMatch(/30 days/)
  })

  it("steps back and forward by the span, not by a calendar unit", () => {
    const onStep = vi.fn()
    render(<DateControl {...props} onStep={onStep} />)
    screen.getByRole("button", { name: /previous period/i }).click()
    expect(onStep).toHaveBeenCalledWith(-1)
    screen.getByRole("button", { name: /next period/i }).click()
    expect(onStep).toHaveBeenLastCalledWith(1)
  })

  it("offers all four comparisons when the range is short enough", () => {
    render(<DateControl {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /vs the prior period/i }))
    expect(within(screen.getByRole("menu", { name: /comparison/i })).getAllByRole("menuitemradio")).toHaveLength(4)
  })

  it("does NOT offer the weekday comparison on a long range", () => {
    // comparisonRange returns null past 7 days. A control that offers it would
    // render an empty comparison, which reads as "no change" rather than
    // "that question does not apply here".
    render(
      <DateControl
        {...props}
        presetId="d30"
        range={{ start: new Date(2026, 6, 26), end: new Date(2026, 7, 24) }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /vs the prior period/i }))
    const items = within(screen.getByRole("menu", { name: /comparison/i })).getAllByRole("menuitemradio")
    expect(items).toHaveLength(3)
    expect(items.map((i) => i.textContent).join(" ")).not.toMatch(/weekday/i)
  })

  it("closes on Escape without choosing anything", () => {
    const onPreset = vi.fn()
    render(<DateControl {...props} onPreset={onPreset} />)
    const trigger = screen.getByRole("button", { name: /last 7 days/i })
    fireEvent.click(trigger)
    expect(screen.getByRole("menu", { name: /range/i })).toBeTruthy()
    fireEvent.keyDown(trigger, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: /range/i })).toBeNull()
    expect(onPreset).not.toHaveBeenCalled()
  })

  it('labels a custom range by its ends, not "Today"', () => {
    render(
      <DateControl
        presetId="custom"
        comparisonId="prev"
        range={{ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }}
        onPreset={() => {}}
        onComparison={() => {}}
        onStep={() => {}}
      />,
    )
    expect(screen.getByText("Aug 3 – Aug 9")).toBeInTheDocument()
    expect(screen.queryByText("Today")).not.toBeInTheDocument()
  })

  it("checks no preset while a custom range is showing", () => {
    render(
      <DateControl
        presetId="custom"
        comparisonId="prev"
        range={{ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }}
        onPreset={() => {}}
        onComparison={() => {}}
        onStep={() => {}}
      />,
    )
    fireEvent.click(screen.getByText("Aug 3 – Aug 9"))
    const checked = screen
      .getAllByRole("menuitemradio")
      .filter((el) => el.getAttribute("aria-checked") === "true")
    expect(checked).toHaveLength(0)
  })
})
