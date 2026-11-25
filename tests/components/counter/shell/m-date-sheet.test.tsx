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
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MDateSheet } from "@/components/counter/shell/m-date-sheet"
import { COMPARISONS, MENU_PRESETS, comparisonRange } from "@/lib/counter/date-range"

const SHEET = ["counter-components.css"]
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

/**
 * In a browser the drawer renders in place, in the top layer; jsdom has no top
 * layer, so ui-sdk puts it in <body> there, and the sheet is read off
 * `document` rather than the render container.
 *
 * The sheet is a ui-sdk Drawer whose code, like the calendar's, loads on the
 * first tap (next/dynamic), so opening is awaited. Open and closed read off
 * the drawer's own `data-open`; once opened the sheet stays mounted.
 */
async function openSheet(container: HTMLElement) {
  fireEvent.click(container.querySelector(".mdate")!)
  await screen.findByRole("grid")
  await waitFor(() => expect(isOpen(container)).toBe(true))
}
const isOpen = (container: HTMLElement) => document.querySelector(".msheet")?.hasAttribute("data-open") ?? false
const closes = (container: HTMLElement) => waitFor(() => expect(isOpen(container)).toBe(false))

describe("MDateSheet — the phone's date control", async () => {
  it("emits the chip and the sheet the prototype writes, and every class has a rule", async () => {
    const { container } = renderSheet()
    expect(container.querySelector(".mdate")!.tagName).toBe("BUTTON")
    await openSheet(container)
    const sheet = document.querySelector(".msheet")!
    expect([...sheet.children].map((c) => c.className)).toEqual(["msheet__grab", "msheet__title", "msheet__body"])
    expect([...sheet.querySelector(".msheet__body")!.children].map((c) => c.className || c.tagName.toLowerCase())).toEqual([
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

  it("is closed until the chip is tapped, and once opened is never unmounted", async () => {
    // Kept mounted after the first open, so the calendar's month and a
    // half-finished pick survive a close.
    const { container } = renderSheet()
    expect(document.querySelector(".msheet")).toBeNull()
    await openSheet(container)
    expect(document.querySelector(".pshade")).toBeTruthy()
    fireEvent.click(document.querySelector(".mbtn--primary")!)
    await closes(container)
    expect(document.querySelector(".msheet")).toBeTruthy()
  })

  it("offers every preset, pressed on the current one, and reports the tap", async () => {
    const { container, onPreset } = renderSheet()
    await openSheet(container)
    const buttons = [...document.querySelectorAll(".mpresets button")]
    expect(buttons).toHaveLength(MENU_PRESETS.length)
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1)

    fireEvent.click(screen.getByText(MENU_PRESETS[0].name))
    expect(onPreset).toHaveBeenCalledWith(MENU_PRESETS[0].id)
    // The prototype leaves the sheet open on a preset — only [data-mclose]
    // closes it — so a reader can set the window and then the comparison.
    expect(isOpen(container)).toBe(true)
  })

  it("offers only the comparisons this range can actually compute", async () => {
    // Same rule `DateControl` keeps, for the same reason: a comparison the page
    // cannot compute renders an empty delta, which reads as "no change" rather
    // than "that question does not apply here". "weekday" has no meaning past a
    // week.
    const { container, unmount } = renderSheet({ range: DAY })
    await openSheet(container)
    const onDay = [...document.querySelectorAll(".drcmp button")].map((b) => b.textContent)
    unmount()

    const { container: wide } = renderSheet({ range: { start: new Date(2026, 6, 1), end: new Date(2026, 7, 21) } })
    await openSheet(wide)
    const onLong = [...document.querySelectorAll(".drcmp button")].map((b) => b.textContent)

    const weekday = COMPARISONS.find((c) => c.id === "weekday")!
    expect(comparisonRange(DAY, "weekday")).not.toBeNull()
    expect(onDay).toContain(weekday.name)
    expect(onLong).not.toContain(weekday.name)
  })

  it("a comparison tap reports it and leaves the sheet open", async () => {
    const { container, onComparison } = renderSheet()
    await openSheet(container)
    const none = COMPARISONS.find((c) => c.id === "none")!
    fireEvent.click(screen.getByText(none.name))
    expect(onComparison).toHaveBeenCalledWith("none")
    expect(isOpen(container)).toBe(true)
  })

  it("one calendar tap picks that day and closes the sheet", async () => {
    const { container, onRange } = renderSheet()
    await openSheet(container)
    const days = [...document.querySelectorAll(".drd:not(.out)")]
    fireEvent.click(days[9])
    expect(onRange).toHaveBeenCalledTimes(1)
    const [r] = onRange.mock.calls[0]
    expect([r.start.getDate(), r.end.getDate()]).toEqual([10, 10])
    await closes(container)
  })

  it("in range mode, two calendar taps make a range, and one on its own does not", async () => {
    const { container, onRange } = renderSheet()
    await openSheet(container)
    fireEvent.click(screen.getByRole("button", { name: "A range" }))
    const days = [...document.querySelectorAll(".drd:not(.out)")]
    fireEvent.click(days[9])
    expect(onRange).not.toHaveBeenCalled()
    fireEvent.click(days[14])
    expect(onRange).toHaveBeenCalledTimes(1)
    const [r] = onRange.mock.calls[0]
    expect(r.start.getTime()).toBeLessThanOrEqual(r.end.getTime())
  })

  it("the primary button says what it will show, and closing is all it does", async () => {
    const { container, onPreset, onComparison, onRange } = renderSheet()
    await openSheet(container)
    const apply = document.querySelector(".mbtn--primary")!
    expect(apply.textContent).toBe("Show Last 7 days")
    fireEvent.click(apply)
    await closes(container)
    // Every choice already applied when it was made; this cannot apply a
    // second one behind the reader's back.
    expect(onPreset).not.toHaveBeenCalled()
    expect(onComparison).not.toHaveBeenCalled()
    expect(onRange).not.toHaveBeenCalled()
  })

  it("names a stepped single day by its weekday", async () => {
    const { container } = renderSheet({ range: DAY, presetId: "custom" })
    await openSheet(container)
    expect(document.querySelector(".mbtn--primary")!.textContent).toBe("Show Friday")
  })

  it("has ‹ › arrows beside the chip that step through onRange", async () => {
    const { container, onRange } = renderSheet({ range: DAY, presetId: "custom" })
    fireEvent.click(screen.getByRole("button", { name: /^Earlier/ }))
    const [r] = onRange.mock.calls[0]
    expect([r.start.getDate(), r.end.getDate()]).toEqual([20, 20])
    expect(container.querySelectorAll(".mdatebar .mstep")).toHaveLength(2)
  })

  it("the shade and Escape both close it without choosing anything", async () => {
    const { container, onPreset, onRange } = renderSheet()
    await openSheet(container)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await closes(container)
    await openSheet(container)
    const shade = document.querySelector(".pshade")!
    fireEvent.pointerDown(shade)
    fireEvent.pointerUp(shade)
    fireEvent.click(shade)
    await closes(container)
    expect(onPreset).not.toHaveBeenCalled()
    expect(onRange).not.toHaveBeenCalled()
  })

  it("carries none of the DESK bar's classes", async () => {
    // The phone has its own round `.mstep` arrows; `.dr__step` / `.dr__today`
    // belong to the desk bar and its stylesheet.
    const { container } = renderSheet()
    await openSheet(container)
    expect(container.querySelector(".dr")).toBeNull()
    expect(container.querySelector(".dr__step")).toBeNull()
    expect(container.querySelector(".dr__today")).toBeNull()
  })

  it("emits no landmark class, so it adds nothing to the fidelity count", async () => {
    const { container } = renderSheet()
    await openSheet(container)
    for (const c of ["btn", "sec", "strip", "band", "blt", "sp", "kv", "empty", "fig"]) {
      expect(document.body.querySelectorAll(`.${c}`).length, `.${c}`).toBe(0)
    }
  })
})
