// @vitest-environment jsdom
/**
 * The desk composition, asserted against `P.pnl.desk()`'s own order
 * (`docs/counter/counter-prototype.html:5245`).
 *
 * The fidelity gate measures the same thing in a browser against the prototype
 * itself. These are the fast half: the ORDER, the two blocks that must NOT be
 * inside a section, the arithmetic the cascade prints, and the one gesture on
 * this page that changes the range.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

const push = vi.fn()
// The island calls `useRouter()` unconditionally (the controls push), and a
// plain RTL render is not an App Router tree.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

import { CounterPnlClient } from "@/app/dashboard/pnl/counter-pnl-client"
import { ready, empty, failed } from "@/lib/counter/section-data"
import { trailingWeeks } from "@/lib/counter/date-range"
import type { PnlSections } from "@/lib/counter/adapters/pnl"

const TODAY = new Date(2026, 7, 25) // Tuesday 25 Aug 2026
const WEEKS = trailingWeeks(TODAY, 8)

const base = {
  pathname: "/dashboard/pnl",
  // Plain text, never a URLSearchParams instance — see the island's own note.
  params: "",
  stores: [
    { id: "hollywood", name: "Hollywood", stage: "trading" as const },
    { id: "glendale", name: "Glendale", stage: "pre_open" as const },
  ],
  user: { name: "Chris Karimian", role: "Owner" },
  today: TODAY,
}

/**
 * A cascade whose subtractions actually reach its own bottom line, so the
 * reconciliation test is measuring the COMPONENT rather than a fixture that
 * was written to agree with itself. 25,879 − 4,632 − 8,120 − 6,540 − 2,100 −
 * 1,240 = 3,247.
 */
const CASCADE = {
  start: { name: "Gross sales", sub: "1,024 orders", amount: 25_879 },
  cuts: [
    { name: "Marketplace commissions", sub: "3 marketplaces", amount: 4_632 },
    { name: "Food", sub: "against a 29.0% target", amount: 8_120, over: true },
    { name: "Labor", sub: "clock-ins where Harri covers, the store file where it does not", amount: 6_540 },
    { name: "Occupancy", sub: "rent, prorated across 7 days", amount: 2_100 },
    { name: "Other operating", sub: "towels, cleaning and custom fixed lines", amount: 1_240 },
  ],
  end: { name: "Bottom line", sub: "12.5% of sales" },
}

const sections: PnlSections = {
  headline: ready({
    cells: [
      { label: "Bottom line", value: "$3,247", delta: "12.5% of sales" },
      { label: "Prime cost", value: "56.2%", delta: "▲ 1.4 pts vs prior", caption: "Ceiling 60.0%" },
      { label: "Food", value: "31.4%", caption: "Target 29.0%" },
      { label: "Labor", value: "24.8%", caption: "$6,540" },
      { label: "Gross sales", value: "$25,879", delta: "▲ 4.1% vs the prior period" },
    ],
    // The phone's own two, from the same statement — `/m/pnl` renders these
    // and this page does not. Present here because `PnlHeadline` is one shape.
    phoneCells: [
      { label: "Bottom line", value: "$3,247", delta: "12.5% of sales" },
      { label: "Prime cost", value: "56.2%", delta: "3.8 pts of room" },
    ],
    reading: [
      { text: "You kept $3,247", strong: true },
      { text: " of $25,879 over 7 days — a margin of " },
      { text: "12.5%", strong: true },
      { text: "." },
    ],
  }),
  cascade: ready(CASCADE),
  weeks: ready({
    rows: WEEKS.map((w, i) => ({
      window: w,
      grossSales: 20_000 + i * 500,
      cogsPct: 31.4,
      laborPct: 24.8,
      primePct: 56.2,
      bottomLine: 2_500 + i * 100,
      marginPct: 12.5,
    })),
    foodTargetPct: 29,
  }),
  statement: ready({
    comparisonLabel: "the prior period",
    fixedInRange: "$3,340",
    lines: [
      { key: "gross", name: "Gross sales", sub: "1,024 orders", strong: true, amount: "$25,879", share: "100.0%", comparison: "$24,860", change: "▲ 4.1%", loud: false, worth: "+$1,019" },
      { key: "commissions", name: "Marketplace commissions", sub: "what the marketplaces kept", amount: "−$4,632", share: "17.9%", comparison: "17.4%", change: "▲ 0.5 pts", loud: false, worth: "+$129", href: "/dashboard/analytics" },
      { key: "net", name: "Net revenue", strong: true, amount: "$21,247", share: "82.1%", comparison: "82.6%", change: "▼ 0.5 pts", loud: false, worth: "−$129" },
      { key: "food", name: "Food", sub: "target 29.0%", amount: "−$8,120", share: "31.4%", comparison: "30.1%", change: "▲ 1.3 pts", loud: true, worth: "+$336", href: "/dashboard/cogs" },
      { key: "labor", name: "Labor", sub: "clock-ins plus the store file", amount: "−$6,540", share: "25.3%", comparison: "24.9%", change: "▲ 0.4 pts", loud: false, worth: "+$104", href: "/dashboard/labor" },
      { key: "prime", name: "Prime cost", sub: "ceiling 60.0%", strong: true, amount: "$14,660", share: "56.7%", comparison: "55.0%", change: "▲ 1.7 pts", loud: false, worth: "+$440" },
      { key: "occupancy", name: "Occupancy", sub: "rent, prorated", amount: "−$2,100", share: "8.1%", comparison: "8.4%", change: "▼ 0.3 pts", loud: false, worth: "−$78", href: "/dashboard/stores" },
      { key: "other", name: "Other operating", sub: "towels, cleaning and custom fixed lines", amount: "−$1,240", share: "4.8%", comparison: "4.6%", change: "▲ 0.2 pts", loud: false, worth: "+$52", href: "/dashboard/stores" },
      { key: "bottom", name: "Bottom line", strong: true, amount: "$3,247", share: "12.5%", comparison: "13.6%", change: "▼ 1.1 pts", loud: false, worth: "−$285" },
    ],
  }),
  byStore: ready([
    { id: "hollywood", name: "Hollywood", stage: "trading", grossSales: 25_879, primePct: 56.2, fixedOnFile: 2_100, rentOnFile: true },
    { id: "glendale", name: "Glendale", stage: "pre_open", grossSales: null, primePct: null, fixedOnFile: null, rentOnFile: false },
  ]),
  trust: { status: "not_computed", owed: "a per-line provenance model" },
  foodCause: { status: "not_computed", owed: "a cause-attribution model" },
}

const main = (c: HTMLElement) => c.querySelector("main#ct-main") as HTMLElement

/** Every `.wf__v` figure, as a number. Brackets are `money`'s negative. */
function cascadeFigures(c: HTMLElement): number[] {
  return Array.from(c.querySelectorAll(".wf__row .wf__v")).map((el) => {
    const t = el.textContent ?? ""
    const n = Number(t.replace(/[^0-9.]/g, ""))
    // `−$4,632` is a cut; `($4,632)` is a negative total.
    return /^[(−]/.test(t.trim()) ? -n : n
  })
}

beforeEach(() => push.mockClear())

describe("Counter P&L", () => {
  it("titles the page with its NAME, and subtitles it with the store, window, days and comparison", () => {
    // `P.pnl.title` is "Profit and loss" — unlike the Overview, whose title is
    // a sentence about the range. A statement is the same document whatever
    // window it is drawn over.
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    expect(screen.getByRole("heading", { level: 2, name: "Profit and loss" })).toBeTruthy()
    expect(container.querySelector(".pagehead .sub")?.textContent).toBe(
      "All stores · Aug 24 · 1 day · vs the prior period",
    )
    expect(screen.getByRole("navigation", { name: /breadcrumb/i }).textContent).toBe(
      "All stores/P&L",
    )
  })

  it("names the window by its ENDS on a preset too, never by the preset's name", () => {
    // `CD.rangeLabel()` is `fmtRange()` (prototype line 1862) — two dates, no
    // preset branch — and `P.pnl.desk()` calls it for the cascade's meta
    // (5313) and the week table's unmarked note (5172). With the PRESET's name
    // here the desk printed "Last 7 days" where the phone, from the same
    // range, printed "Aug 19 – Aug 25": one window, two names, across two
    // surfaces of one page.
    const { container } = render(
      <CounterPnlClient {...base} params="range=d7" sections={sections} />,
    )
    expect(container.querySelector(".pagehead .sub")?.textContent).toBe(
      "All stores · Aug 19 – Aug 25 · 7 days · vs the prior period",
    )
    const cascadeMeta = main(container).querySelector(".sec .sec__head .k")?.textContent
    expect(cascadeMeta).toBe("Aug 19 – Aug 25 · the bar is what is left after each line")
    // The same label again, in the note the week table prints when the range
    // above it is not one of its eight rows.
    expect(main(container).textContent).toContain(
      "The range above is Aug 19 – Aug 25, which is not one of these weeks",
    )
    // "Last 7 days" is still on the page exactly once, inside the date
    // control, which is the prototype's own `presetName()` at line 1919 — the
    // control names the preset, the page names the window.
    expect(
      Array.from(main(container).querySelectorAll(".sec__head .k")).map((e) => e.textContent),
    ).toEqual([
      "Aug 19 – Aug 25 · the bar is what is left after each line",
      "press a week to read it in full · every figure is this same statement over that window",
      "against the prior period · same 7 days, so the change column is readable",
      "2 stores, 2 stages",
    ])
  })

  it("composes the page in the prototype's order, with the strip and the reading OUTSIDE any section", () => {
    // The whole task as one assertion: strip → reading → cascade → eight weeks
    // → statement → the split → by store.
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const kids = [...main(container).children].map((c) => c.className.split(" ")[0])
    expect(kids).toEqual([
      "pagehead",
      "strip",
      "ans__lead",
      "sec", // where it went
      "sec", // the last eight weeks
      "sec", // the statement
      "split", // food cause + trust
      "sec", // by store
    ])
    for (const cls of [".strip", ".ans__lead"]) {
      expect(main(container).querySelector(cls)!.closest(".sec")).toBeNull()
    }
  })

  it("renders the landmark sequence in the prototype's order — the cascade before the weeks before the statement", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const CLASSES = ["strip", "ans__lead", "wf", "wkt", "tbl", "split", "sec", "empty"]
    const seq = Array.from(main(container).querySelectorAll("*"))
      .map((el) => CLASSES.filter((c) => el.classList.contains(c)).join("."))
      .filter((s) => s !== "")
    expect(seq.indexOf("strip")).toBeLessThan(seq.indexOf("ans__lead"))
    expect(seq.indexOf("ans__lead")).toBeLessThan(seq.indexOf("wf"))
    expect(seq.indexOf("wf")).toBeLessThan(seq.indexOf("wkt"))
    expect(seq.indexOf("wkt")).toBeLessThan(seq.indexOf("tbl"))
    expect(seq.indexOf("tbl")).toBeLessThan(seq.indexOf("split"))
    // Nothing is a grey empty box on a page with data.
    expect(seq).not.toContain("empty")
  })

  it("bolds the figure the ADAPTER chose, and puts no element around the plain text", () => {
    // `.ans__lead b` is a real rule in the ported sheet, and which figure
    // carries the emphasis is a judgement the adapter makes.
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const lead = container.querySelector(".ans__lead") as HTMLElement
    expect(Array.from(lead.querySelectorAll("b")).map((b) => b.textContent)).toEqual([
      "You kept $3,247",
      "12.5%",
    ])
    // Two bold runs and nothing else: the plain segments are text nodes.
    expect(lead.children).toHaveLength(2)
  })

  /**
   * The one assertion this page cannot ship without.
   *
   * A statement that does not add up is worse than no statement, because it is
   * a picture of arithmetic and the reader will trust it over their own.
   * `Cascade` computes the end from the cuts, so this holds by construction —
   * which is exactly why it is asserted on the RENDERED DOM rather than on the
   * inputs: the thing being checked is what the reader can see.
   */
  it("prints a cascade that reconciles — start, minus every subtraction, is the bottom line", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const figures = cascadeFigures(container)
    expect(figures).toHaveLength(7)
    const start = figures[0]
    const cuts = figures.slice(1, -1)
    const end = figures[figures.length - 1]
    expect(start - cuts.reduce((t, c) => t + Math.abs(c), 0)).toBe(end)
    // And the bottom line it reaches is the one the strip above it prints.
    expect(container.querySelector(".strip .v")!.textContent).toBe(`$${end.toLocaleString("en-US")}`)
  })

  it("paints exactly one cut red — the one line that beat a published target", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    expect(container.querySelectorAll(".wf__cut.is-over")).toHaveLength(1)
    expect(container.querySelectorAll(".wf__cut")).toHaveLength(5)
  })

  it("presses a week and moves the DATE CONTROL — not just the figures", () => {
    // `writeCounterParams({ range })` writes `?from=…&to=…`, which
    // `readCounterParams` reads back as a custom range and the control names.
    // This machinery was built two plans ago and this is its first caller.
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const rows = container.querySelectorAll(".wkt tbody tr")
    expect(rows).toHaveLength(8)
    fireEvent.click(rows[2])
    const w = WEEKS[2]
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    expect(push).toHaveBeenCalledWith(
      `/dashboard/pnl?from=${iso(w.start)}&to=${iso(w.end)}`,
      { scroll: false },
    )
  })

  it("marks the week the page is currently reading, and only that one", () => {
    const w = WEEKS[3]
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const { container } = render(
      <CounterPnlClient
        {...base}
        params={`from=${iso(w.start)}&to=${iso(w.end)}`}
        sections={sections}
      />,
    )
    const here = container.querySelectorAll(".wkt tbody tr.is-here")
    expect(here).toHaveLength(1)
    expect(here[0].getAttribute("aria-current")).toBe("true")
  })

  it("heads the statement's comparison column with the comparison, and calls out only the loud lines", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const table = container.querySelectorAll("table.tbl")[0] as HTMLElement
    expect(Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent)).toEqual([
      "Line", "This range", "% of sales", "the prior period", "Change", "Worth",
    ])
    expect(table.querySelectorAll("tbody tr")).toHaveLength(9)
    // One of nine. A change column that flags everything flags nothing.
    const hot = table.querySelectorAll("td.hot")
    expect(hot).toHaveLength(1)
    expect(hot[0].textContent).toBe("▲ 1.3 pts")
    // And the page states the rule the paint follows.
    expect(
      screen.getByText(/one point on food, two on labour, three on prime/),
    ).toBeTruthy()
  })

  it("says 'no comparison' in the column head rather than leaving it blank", () => {
    const { container } = render(
      <CounterPnlClient
        {...base}
        params="cmp=none"
        sections={{
          ...sections,
          statement: ready({
            ...(sections.statement as { status: "ready"; data: { lines: unknown[] } }).data,
            comparisonLabel: null,
          } as never),
        }}
      />,
    )
    const table = container.querySelectorAll("table.tbl")[0] as HTMLElement
    expect(table.querySelectorAll("thead th")[3].textContent).toBe("no comparison")
  })

  it("gives every statement row that has a destination one this app actually serves", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const table = container.querySelectorAll("table.tbl")[0] as HTMLElement
    const links = Array.from(table.querySelectorAll("tbody tr[role='link']"))
    expect(links).toHaveLength(5)
    fireEvent.click(links[0])
    expect(push).toHaveBeenCalledWith("/dashboard/analytics")
  })

  it("heads the by-store money column GROSS, because that is the figure in it", () => {
    // `PnlStoreLine.grossSales` IS `StoreStatement.grossSales`. The prototype's
    // column says "Net" while its own statement heads the identical value
    // "Gross sales" (`pnl().gross = R.netTotal()`); this table sits under the
    // statement and follows its word.
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const table = container.querySelectorAll("table.tbl")[1] as HTMLElement
    expect(Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent)).toEqual([
      "Store", "Gross", "Prime", "Fixed on file", "Stage",
    ])
    const rows = table.querySelectorAll("tbody tr")
    expect(within(rows[0] as HTMLElement).getByText("$25,879")).toBeTruthy()
  })

  it("says a store's rent is not on file, rather than printing a zero for it", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const table = container.querySelectorAll("table.tbl")[1] as HTMLElement
    const glendale = table.querySelectorAll("tbody tr")[1] as HTMLElement
    const cell = within(glendale).getByText("not on file")
    expect(cell.className).toContain("text-ct-warn")
    // And the callout says what the missing field costs the reader.
    expect(screen.getByText(/would make the group look more profitable than it is/)).toBeTruthy()
  })

  /**
   * The sheet's `is-hole` pair — `tr.is-hole td{background:var(--bad-wash)}`
   * and `tr.is-hole .hole{font-style:italic;color:var(--bad)}` — was tried
   * here and is the wrong element. It is what a document line that is WRONG
   * looks like: two whole rows washed red on a P&L. A pre-open store with no
   * rent yet is not wrong, it is early, and the Stage column beside it says
   * so. The prototype paints ONE cell `var(--warn)` and leaves the row alone.
   */
  it("does not paint a pre-open store's row as a document that is wrong", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const table = container.querySelectorAll("table.tbl")[1] as HTMLElement
    expect(table.querySelectorAll("tr.is-hole")).toHaveLength(0)
    expect(table.querySelectorAll("td.hole")).toHaveLength(0)
    // The stage is what says why the cell is empty.
    expect(within(table).getByText("Pre-open").className).toContain("mtag")
  })

  it("derives the by-store sentence from the ROWS, not from one account", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    expect(container.textContent).toContain(
      "Every line above is Hollywood, because it is the only store with sales in this range",
    )
    const { container: two } = render(
      <CounterPnlClient
        {...base}
        sections={{
          ...sections,
          byStore: ready([
            { id: "a", name: "Hollywood", stage: "trading", grossSales: 1, primePct: 50, fixedOnFile: 1, rentOnFile: true },
            { id: "b", name: "Glendale", stage: "trading", grossSales: 2, primePct: 50, fixedOnFile: 1, rentOnFile: true },
          ]),
        }}
      />,
    )
    expect(two.textContent).toContain(
      "Every line above is Hollywood and Glendale, because they are the only stores with sales in this range",
    )
    // With every rent on file, nothing is held out — and the callout says so
    // rather than disappearing and leaving the reader to infer it.
    expect(two.textContent).toContain("Every store carries a rent line")
  })

  it("names the two owed sections instead of drawing half an answer as a whole one", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const split = main(container).querySelector(".split") as HTMLElement
    expect(split.querySelectorAll(".sec")).toHaveLength(2)
    expect(within(split).getByText(/a cause-attribution model/)).toBeTruthy()
    expect(within(split).getByText(/a per-line provenance model/)).toBeTruthy()
    // Not a `.gap` bar whose only segment would be the derived residual.
    expect(container.querySelector(".gap")).toBeNull()
  })

  it("carries each section's own state — the weeks failing does not blank the statement", () => {
    const { container } = render(
      <CounterPnlClient
        {...base}
        sections={{ ...sections, weeks: failed("the weekly rollups timed out", "retryWeeks") }}
      />,
    )
    expect(container.querySelector(".wkt")).toBeNull()
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(container.querySelectorAll("table.tbl")).toHaveLength(2)
  })

  it("renders the empty reason rather than a cascade of zeroes", () => {
    const { container } = render(
      <CounterPnlClient
        {...base}
        sections={{
          ...sections,
          headline: empty("pre_open"),
          cascade: empty("pre_open"),
          weeks: empty("pre_open"),
          statement: empty("pre_open"),
        }}
      />,
    )
    expect(container.querySelector(".wf")).toBeNull()
    expect(container.querySelector(".strip")).toBeNull()
    expect(container.querySelectorAll(".empty").length).toBeGreaterThan(0)
    // The by-store table still answers, because it is the section that says
    // WHICH stores exist — the question a pre-open account most needs answered.
    expect(container.querySelector("table.tbl")).toBeTruthy()
  })
})
