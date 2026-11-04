// @vitest-environment jsdom
/**
 * `MDateSheet` against `CD.chip()` and `CD.sheet()`
 * (`docs/counter/counter-prototype.html` lines 1942 and 1945).
 *
 * This is the phone's half of the most-used control in the product, and — like
 * `.mtop` around it — it lives outside `.mscroll` and so outside everything
 * `npm run fidelity` measures. These tests are the only gate it has.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MDateSheet } from "@/components/counter/shell/m-date-sheet"
import { COMPARISONS, MENU_PRESETS, comparisonRange } from "@/lib/counter/date-range"

const SHEET = ["counter-components.css", "counter-repairs.css"]
  .map((f) => readFileSync(join(process.cwd(), "src/styles", f), "utf8"))
  .join("\n")

const WEEK = { start: new Date(2026, 7, 15), end: new Date(2026, 7, 21) }
const DAY = { start: new Date(2026, 7, 21), end: new Date(2026, 7, 21) }

function renderSheet(over: Partial<React.ComponentProps<typeof MDateSheet>> = {}) {
  const onPreset = vi.fn()
  const onComparison = vi.fn()
  const onRange = vi.fn()
  const utils = render(
    <MDateSheet
      presetId="d7"
      comparisonId="prev"
      range={WEEK}
      onPreset={onPreset}
      onComparison={onComparison}
      onRange={onRange}
      {...over}
    />,
  )
  return { ...utils, onPreset, onComparison, onRange }
}

describe("MDateSheet — the phone's date control", () => {
  it("emits the chip and the sheet the prototype writes, and every class has a rule", () => {
    const { container } = renderSheet()
    expect(container.querySelector(".mdate")!.tagName).toBe("BUTTON")
    const sheet = container.querySelector(".msheet")!
    expect([...sheet.children].map((c) => c.className || c.tagName.toLowerCase())).toEqual([
      "msheet__grab",
      "h4",
      "mpresets",
      "drweeks",
      "drmode",
      "drcals",
      "div",
      "drhint",
      "mbtn mbtn--primary",
    ])
    for (const rule of [
      ".mdate{", ".msheet{", ".mpresets{", ".drcals{", ".drcmp{", ".mbtn{",
      ".mdatebar{", ".mstep{", ".drweeks{", ".drmode{", ".drhint{",
    ]) {
      expect(SHEET, `${rule} has no rule`).toContain(rule)
    }
  })

  it("is closed until the chip is tapped, and the sheet is never unmounted", () => {
    // The prototype shows it with `.on`, not by mounting it. Keeping that means
    // the calendar's month and a half-finished pick survive a close.
    const { container } = renderSheet()
    expect(container.querySelector(".msheet")!.className).toBe("msheet")
    fireEvent.click(container.querySelector(".mdate")!)
    expect(container.querySelector(".msheet")!.className).toBe("msheet on")
    expect(container.querySelector(".pshade")!.className).toBe("pshade on")
  })

  it("offers every preset, pressed on the current one, and reports the tap", () => {
    const { container, onPreset } = renderSheet()
    fireEvent.click(container.querySelector(".mdate")!)
    const buttons = [...container.querySelectorAll(".mpresets button")]
    expect(buttons).toHaveLength(MENU_PRESETS.length)
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1)

    fireEvent.click(screen.getByText(MENU_PRESETS[0].name))
    expect(onPreset).toHaveBeenCalledWith(MENU_PRESETS[0].id)
    // The prototype leaves the sheet open on a preset — only [data-mclose]
    // closes it — so a reader can set the window and then the comparison.
    expect(container.querySelector(".msheet")!.className).toBe("msheet on")
  })

  it("offers only the comparisons this range can actually compute", () => {
    // Same rule `DateControl` keeps, for the same reason: a comparison the page
    // cannot compute renders an empty delta, which reads as "no change" rather
    // than "that question does not apply here". "weekday" has no meaning past a
    // week.
    const { container, unmount } = renderSheet({ range: DAY })
    fireEvent.click(container.querySelector(".mdate")!)
    const onDay = [...container.querySelectorAll(".drcmp button")].map((b) => b.textContent)
    unmount()

    const { container: wide } = renderSheet({ range: { start: new Date(2026, 6, 1), end: new Date(2026, 7, 21) } })
    fireEvent.click(wide.querySelector(".mdate")!)
    const onLong = [...wide.querySelectorAll(".drcmp button")].map((b) => b.textContent)

    const weekday = COMPARISONS.find((c) => c.id === "weekday")!
    expect(comparisonRange(DAY, "weekday")).not.toBeNull()
    expect(onDay).toContain(weekday.name)
    expect(onLong).not.toContain(weekday.name)
  })

  it("a comparison tap reports it and leaves the sheet open", () => {
    const { container, onComparison } = renderSheet()
    fireEvent.click(container.querySelector(".mdate")!)
    const none = COMPARISONS.find((c) => c.id === "none")!
    fireEvent.click(screen.getByText(none.name))
    expect(onComparison).toHaveBeenCalledWith("none")
    expect(container.querySelector(".msheet")!.className).toBe("msheet on")
  })

  it("one calendar tap picks that day and closes the sheet", () => {
    const { container, onRange } = renderSheet()
    fireEvent.click(container.querySelector(".mdate")!)
    const days = [...container.querySelectorAll(".drd:not(.out)")]
    fireEvent.click(days[9])
    expect(onRange).toHaveBeenCalledTimes(1)
    const [r] = onRange.mock.calls[0]
    expect([r.start.getDate(), r.end.getDate()]).toEqual([10, 10])
    expect(container.querySelector(".msheet")!.className).toBe("msheet")
  })

  it("in range mode, two calendar taps make a range, and one on its own does not", () => {
    const { container, onRange } = renderSheet()
    fireEvent.click(container.querySelector(".mdate")!)
    fireEvent.click(screen.getByRole("button", { name: "A range" }))
    const days = [...container.querySelectorAll(".drd:not(.out)")]
    fireEvent.click(days[9])
    expect(onRange).not.toHaveBeenCalled()
    fireEvent.click(days[14])
    expect(onRange).toHaveBeenCalledTimes(1)
    const [r] = onRange.mock.calls[0]
    expect(r.start.getTime()).toBeLessThanOrEqual(r.end.getTime())
  })

  it("the primary button says what it will show, and closing is all it does", () => {
    const { container, onPreset, onComparison, onRange } = renderSheet()
    fireEvent.click(container.querySelector(".mdate")!)
    const apply = container.querySelector(".mbtn--primary")!
    expect(apply.textContent).toBe("Show Last 7 days")
    fireEvent.click(apply)
    expect(container.querySelector(".msheet")!.className).toBe("msheet")
    // Every choice already applied when it was made; this cannot apply a
    // second one behind the reader's back.
    expect(onPreset).not.toHaveBeenCalled()
    expect(onComparison).not.toHaveBeenCalled()
    expect(onRange).not.toHaveBeenCalled()
  })

  it("names a stepped single day by its weekday", () => {
    const { container } = renderSheet({ range: DAY, presetId: "custom" })
    fireEvent.click(container.querySelector(".mdate")!)
    expect(container.querySelector(".mbtn--primary")!.textContent).toBe("Show Friday")
  })

  it("has ‹ › arrows beside the chip that step through onRange", () => {
    const { container, onRange } = renderSheet({ range: DAY, presetId: "custom" })
    fireEvent.click(screen.getByRole("button", { name: /^Earlier/ }))
    const [r] = onRange.mock.calls[0]
    expect([r.start.getDate(), r.end.getDate()]).toEqual([20, 20])
    expect(container.querySelectorAll(".mdatebar .mstep")).toHaveLength(2)
  })

  it("the shade and Escape both close it without choosing anything", () => {
    const { container, onPreset, onRange } = renderSheet()
    fireEvent.click(container.querySelector(".mdate")!)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(container.querySelector(".msheet")!.className).toBe("msheet")
    fireEvent.click(container.querySelector(".mdate")!)
    fireEvent.click(container.querySelector(".pshade")!)
    expect(container.querySelector(".msheet")!.className).toBe("msheet")
    expect(onPreset).not.toHaveBeenCalled()
    expect(onRange).not.toHaveBeenCalled()
  })

  it("carries none of the DESK bar's classes", () => {
    // The phone has its own round `.mstep` arrows; `.dr__step` / `.dr__today`
    // belong to the desk bar and its stylesheet.
    const { container } = renderSheet()
    fireEvent.click(container.querySelector(".mdate")!)
    expect(container.querySelector(".dr")).toBeNull()
    expect(container.querySelector(".dr__step")).toBeNull()
    expect(container.querySelector(".dr__today")).toBeNull()
  })

  it("emits no landmark class, so it adds nothing to the fidelity count", () => {
    const { container } = renderSheet()
    fireEvent.click(container.querySelector(".mdate")!)
    for (const c of ["btn", "sec", "strip", "band", "blt", "sp", "kv", "empty", "fig"]) {
      expect(container.querySelectorAll(`.${c}`).length, `.${c}`).toBe(0)
    }
  })
})
