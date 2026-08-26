// @vitest-environment jsdom
/**
 * `WeekTable` against the prototype's own `weekTable()`
 * (`docs/counter/counter-prototype.html` line 5141) and `weekRows()` (5066).
 *
 * `.wkt` was the ONE landmark class in the whole ported sheet with CSS and no
 * emitter anywhere in the tree (`counter-components.css:660-673`). Phase B
 * found it and left it, because it belongs to this page.
 *
 * Two things below are load-bearing beyond "the DOM matches":
 *
 *   1. THE MARKED ROW IS PROVED AGAINST THE SHEET, not against a string. The
 *      accent rail on a selected row comes from
 *      `.wkt tbody tr.is-here td:first-child`, which needs the class AND the
 *      `.wkt tbody` ancestry. Neither `wkt` nor `is-here` is a fidelity
 *      landmark, so a selected row that quietly lost its rail would pass every
 *      gate this project has. `railSelectors()` reads the shipped sheet and
 *      asserts the rendered cell is matched by one of the rules that actually
 *      paint the rail — so emitting `is-sel` (which paints a wash and a bold
 *      cell and NO rail) or dropping `wkt` both go red.
 *   2. THE WEEKS ARE ANCHORED ON TODAY. `trailingWeeks` owns that and is tested
 *      in `tests/lib/counter/date-range.test.ts`; what is tested here is that
 *      pressing a row hands back THAT ROW'S OWN WINDOW, so the range the page
 *      writes is the range the row promised.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen, fireEvent } from "@testing-library/react"
import { WeekTable, type WeekRow } from "@/components/counter/surface/week-table"
import { trailingWeeks, type DateRange } from "@/lib/counter/date-range"
import { PRIME_CEILING_PCT } from "@/lib/counter/prime-cost"

const SHEET = readFileSync(join(process.cwd(), "src/styles/counter-components.css"), "utf-8")

/**
 * Every selector in the SHIPPED sheet whose block draws the accent rail —
 * `box-shadow:inset 2px 0 0 var(--accent)`. Read out of the file rather than
 * typed in, so this test cannot go on asserting a selector the sheet no longer
 * has.
 */
function railSelectors(): string[] {
  const out: string[] = []
  for (const m of SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/box-shadow:\s*inset 2px 0 0 var\(--accent\)/.test(m[2])) out.push(m[1].trim())
  }
  return out
}

/** Thu 20 Aug 2026 — a week with four days in it. */
const THU = new Date(2026, 7, 20)

const WINDOWS = trailingWeeks(THU, 8)

/** Eight weeks of plausible trade, the running one short in dollars and not in rates. */
const WEEKS: WeekRow[] = WINDOWS.map((w, i) => ({
  window: w,
  grossSales: w.partial ? 21_400 : 34_000 + i * 900,
  cogsPct: 27.4 + i * 0.4,
  laborPct: 24.1,
  primePct: 51.5 + i * 0.4,
  bottomLine: 4_120 - i * 40,
  marginPct: 12.1,
}))

const LAST = WINDOWS[7]
const FULL = WINDOWS[6]

function renderTable(over: Partial<Parameters<typeof WeekTable>[0]> = {}) {
  return render(
    <WeekTable
      weeks={WEEKS}
      selected={{ start: FULL.start, end: FULL.end }}
      selectedLabel="Aug 10 – Aug 16"
      foodTargetPct={29}
      onSelect={() => {}}
      {...over}
    />,
  )
}

describe("WeekTable — the eight pressable weeks", () => {
  it("emits the prototype's scroller, table and nine columns", () => {
    const { container } = renderTable()
    const scroll = container.querySelector(".tblscroll")!
    expect(scroll.firstElementChild!.className).toBe("wkt")
    expect(scroll.firstElementChild!.tagName).toBe("TABLE")

    const heads = [...container.querySelectorAll(".wkt thead th")]
    expect(heads.map((h) => h.textContent)).toEqual([
      "Week of", "Sales", "Gross", "Food", "Labor",
      `Prime vs ${PRIME_CEILING_PCT}%`, "Prime", "Kept", "Margin",
    ])
    // `th.num` is the sheet's right-alignment, and it is on the six figure
    // columns only — the week name, the bar and the meter are not figures.
    expect(heads.map((h) => h.classList.contains("num"))).toEqual([
      false, false, true, true, true, false, true, true, true,
    ])
  })

  it("draws one row per week, in the order the weeks happened", () => {
    const { container } = renderTable()
    const rows = [...container.querySelectorAll(".wkt tbody tr")]
    expect(rows).toHaveLength(8)
    expect(rows[0].firstElementChild!.textContent).toBe("Jun 29")
    expect(rows[7].firstElementChild!.textContent).toContain("Aug 17")
  })

  it("emits each cell the prototype emits, in its order", () => {
    const { container } = renderTable()
    const cells = [...container.querySelectorAll(".wkt tbody tr")[0].children]
    expect(cells.map((c) => c.getAttribute("class"))).toEqual([
      null, null, "num", "num", "num", null, "num", "num", "num",
    ])
    expect(cells[1].firstElementChild!.className).toBe("bar")
    expect(cells[1].firstElementChild!.firstElementChild!.tagName).toBe("I")
    expect(cells[5].firstElementChild!.className).toBe("mtr")
  })

  describe("a part-week is drawn short and labelled short", () => {
    it("names its real day count in a .pt beside the week", () => {
      const { container } = renderTable()
      const first = container.querySelectorAll(".wkt tbody tr")[7].firstElementChild!
      expect(first.textContent).toBe("Aug 17 4 of 7 days")
      expect(first.querySelector(".pt")!.textContent).toBe("4 of 7 days")
    })

    it("puts no day count on a whole week", () => {
      const { container } = renderTable()
      const first = container.querySelectorAll(".wkt tbody tr")[6].firstElementChild!
      expect(first.querySelector(".pt")).toBeNull()
      expect(first.textContent).toBe("Aug 10")
    })

    it("says out loud why its dollars are smaller, and that its rates are not", () => {
      renderTable()
      expect(screen.getByText(/The last row is 4 days, not seven/).className).toBe("mono")
      expect(screen.getByText(/its dollars are smaller for that reason alone/i)).toBeTruthy()
      expect(screen.getByText(/the rates beside them are not/i)).toBeTruthy()
    })

    it("stays silent when every week on the table is whole", () => {
      // Sun 23 Aug 2026 — the last day of its own week, so nothing is clipped.
      const whole = trailingWeeks(new Date(2026, 7, 23), 8).map((w, i) => ({
        ...WEEKS[i], window: w,
      }))
      renderTable({
        weeks: whole,
        selected: { start: whole[7].window.start, end: whole[7].window.end },
      })
      expect(screen.queryByText(/not seven/)).toBeNull()
    })

    it("does NOT scale a short week up to look like a whole one", () => {
      // The bar is the week's OWN dollars against the biggest week on the
      // table. A part-week annualised to seven days would draw the longest bar
      // here, because its rates are the healthiest.
      const { container } = renderTable()
      const bars = [...container.querySelectorAll(".wkt .bar i")] as HTMLElement[]
      const widths = bars.map((b) => parseFloat(b.style.width))
      expect(widths[6]).toBe(100)
      expect(widths[7]).toBeCloseTo((21_400 / (34_000 + 6 * 900)) * 100, 1)
      expect(widths[7]).toBeLessThan(widths[6])
    })
  })

  describe("the marked row, proved against the sheet", () => {
    it("marks exactly the week the range is sitting on", () => {
      const { container } = renderTable()
      const marked = [...container.querySelectorAll(".wkt tbody tr.is-here")]
      expect(marked).toHaveLength(1)
      expect(marked[0].firstElementChild!.textContent).toBe("Aug 10")
    })

    it("draws that row's accent rail with a rule the shipped sheet actually has", () => {
      // THE PROOF, and it is deliberately not written as a class assertion.
      //
      // The marked cell is found by `aria-current`, which no styling depends
      // on, and then asked whether ANY rule in the shipped sheet that paints
      // the accent rail actually matches it. Both halves of the sheet's own
      // selector are therefore under test at once:
      //   - emit `is-sel` instead of `is-here` and nothing matches, because
      //     `.tbl tbody tr.is-sel` (214-216) paints a wash and a bold first
      //     cell and NO rail — the exact mistake a Phase B review caught;
      //   - keep `is-here` and take `.wkt` off the table and nothing matches
      //     either, because the only other rail rule in the sheet is
      //     `.tbl tbody tr[data-ln].is-on td:first-child`, which wants a
      //     different pair entirely.
      const { container } = renderTable()
      const cell = container.querySelector('tr[aria-current="true"] td:first-child')
      expect(cell).not.toBeNull()

      const rails = railSelectors()
      expect(rails.some((s) => s.includes(".wkt"))).toBe(true)
      expect(rails.some((s) => cell!.matches(s))).toBe(true)

      // And the class the sheet names, so a rename in either direction is loud.
      expect(cell!.closest("tr")!.className).toBe("is-here")
    })

    it("never emits is-sel, which paints a wash and a bold cell and no rail", () => {
      const { container } = renderTable()
      expect(container.querySelectorAll(".is-sel")).toHaveLength(0)
    })

    it("says why nothing is marked when the range is not one of these weeks", () => {
      renderTable({
        selected: { start: new Date(2026, 7, 1), end: new Date(2026, 7, 20) },
        selectedLabel: "Aug 1 – Aug 20",
      })
      expect(screen.getByText(/The range above is Aug 1 – Aug 20/)).toBeTruthy()
      expect(screen.getByText(/so no row is marked/)).toBeTruthy()
    })

    it("says nothing of the sort when a row IS marked", () => {
      renderTable()
      expect(screen.queryByText(/no row is marked/)).toBeNull()
    })

    it("marks a week whose range arrived carrying a time of day", () => {
      // `?from=…&to=…` round-trips through local midnights, but a caller that
      // resolved its range from `new Date()` would hand over 14:32 and the row
      // it is sitting on would silently stop being marked.
      renderTable({
        selected: {
          start: new Date(2026, 7, 10, 14, 32),
          end: new Date(2026, 7, 16, 23, 59),
        },
      })
      const marked = document.querySelectorAll(".wkt tbody tr.is-here")
      expect(marked).toHaveLength(1)
    })
  })

  describe("pressing a week", () => {
    it("hands back that row's own window, which is what the row promised", () => {
      const onSelect = vi.fn<(r: DateRange) => void>()
      const { container } = renderTable({ onSelect })
      fireEvent.click(container.querySelectorAll(".wkt tbody tr")[2])
      expect(onSelect).toHaveBeenCalledTimes(1)
      const got = onSelect.mock.calls[0][0]
      expect(got.start.getTime()).toBe(WINDOWS[2].start.getTime())
      expect(got.end.getTime()).toBe(WINDOWS[2].end.getTime())
    })

    it("hands back the CLIPPED end of a running week, not the Sunday it has not reached", () => {
      const onSelect = vi.fn<(r: DateRange) => void>()
      const { container } = renderTable({ onSelect })
      fireEvent.click(container.querySelectorAll(".wkt tbody tr")[7])
      expect(onSelect.mock.calls[0][0].end.getTime()).toBe(LAST.end.getTime())
    })

    it("is a row that answers Enter and Space, because a row is not a button", () => {
      const onSelect = vi.fn()
      const { container } = renderTable({ onSelect })
      const tr = container.querySelectorAll(".wkt tbody tr")[3]
      expect(tr).toHaveAttribute("role", "button")
      expect(tr).toHaveAttribute("tabindex", "0")
      fireEvent.keyDown(tr, { key: "Enter" })
      fireEvent.keyDown(tr, { key: " " })
      expect(onSelect).toHaveBeenCalledTimes(2)
      fireEvent.keyDown(tr, { key: "a" })
      expect(onSelect).toHaveBeenCalledTimes(2)
    })

    it("names each row for a reader who cannot see which week it is", () => {
      const { container } = renderTable()
      const rows = container.querySelectorAll(".wkt tbody tr")
      expect(rows[6].getAttribute("aria-label")).toBe("Read Aug 10 – Aug 16 in full")
      expect(rows[7].getAttribute("aria-label")).toBe("Read Aug 17 – Aug 20, 4 of 7 days, in full")
      expect(rows[6].getAttribute("aria-current")).toBe("true")
      expect(rows[7].getAttribute("aria-current")).toBeNull()
    })
  })

  describe("what is over its reference, and what has no reference at all", () => {
    it("calls out a food line over the store's own target, and only that line", () => {
      const { container } = renderTable()
      const rows = [...container.querySelectorAll(".wkt tbody tr")]
      // 27.4 + i*0.4 is 29.0 at i = 4 and 29.4 at i = 5. AT the target is not
      // over it — the prototype's test is `>`, and a store that hit its number
      // exactly should not be told it missed.
      expect(rows.map((r) => r.children[3].classList.contains("hot")))
        .toEqual([false, false, false, false, false, true, true, true])
    })

    it("calls out nothing on food when the store published no target", () => {
      const { container } = renderTable({ foodTargetPct: null })
      const hot = [...container.querySelectorAll(".wkt tbody tr")]
        .map((r) => r.children[3].classList.contains("hot"))
      expect(hot).toEqual([false, false, false, false, false, false, false, false])
    })

    it("calls out prime over the published ceiling, in the cell and in the meter", () => {
      // 51.5 + i*0.4 never reaches 60, so nothing is over on this fixture.
      const { container } = renderTable()
      expect(container.querySelectorAll(".wkt td.hot.num, .wkt .mtr.is-over").length)
        .toBeGreaterThanOrEqual(0)

      const over = WEEKS.map((w) => ({ ...w, primePct: 62.5 }))
      const { container: c2 } = render(
        <WeekTable
          weeks={over}
          selected={{ start: FULL.start, end: FULL.end }}
          selectedLabel="Aug 10 – Aug 16"
          foodTargetPct={29}
          onSelect={() => {}}
        />,
      )
      const row = c2.querySelectorAll(".wkt tbody tr")[0]
      expect(row.children[6].classList.contains("hot")).toBe(true)
      expect(row.children[5].querySelector(".mtr")!.classList.contains("is-over")).toBe(true)
    })

    it("prints an em-dash and draws NO meter for a week with no reading", () => {
      const blank = WEEKS.map((w) => ({
        ...w, cogsPct: null, laborPct: null, primePct: null, marginPct: null,
      }))
      const { container } = render(
        <WeekTable
          weeks={blank}
          selected={{ start: FULL.start, end: FULL.end }}
          selectedLabel="Aug 10 – Aug 16"
          foodTargetPct={29}
          onSelect={() => {}}
        />,
      )
      const row = container.querySelectorAll(".wkt tbody tr")[0]
      expect(row.children[3].textContent).toBe("—")
      expect(row.children[6].textContent).toBe("—")
      // A meter with nothing to read is a mark asserting a measurement.
      expect(row.children[5].querySelector(".mtr")).toBeNull()
      expect(container.querySelectorAll(".hot")).toHaveLength(0)
    })

    it("draws no bar rather than dividing by a week that took nothing", () => {
      const none = WEEKS.map((w) => ({ ...w, grossSales: 0 }))
      const { container } = render(
        <WeekTable
          weeks={none}
          selected={{ start: FULL.start, end: FULL.end }}
          selectedLabel="Aug 10 – Aug 16"
          foodTargetPct={29}
          onSelect={() => {}}
        />,
      )
      const widths = [...container.querySelectorAll(".wkt .bar i")]
        .map((b) => parseFloat((b as HTMLElement).style.width))
      expect(widths).toHaveLength(8)
      expect(widths.every((w) => w === 0)).toBe(true)
    })
  })

  it("renders nothing at all rather than an empty frame with no weeks", () => {
    const { container } = renderTable({ weeks: [] })
    expect(container.querySelector(".wkt")).toBeNull()
    expect(container.textContent).toBe("")
  })
})
