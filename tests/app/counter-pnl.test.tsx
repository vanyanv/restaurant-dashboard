// @vitest-environment jsdom
/**
 * The desk P&L "made plain" (owner-approved 2026-11-03): the kept figure and
 * how it moved, the eight weeks as the picker, Needs you folded, where each
 * dollar went, day by day, store cards, and the full statement folded under
 * them. These assert what a reader sees and the gestures that change the URL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

const push = vi.fn()
// The island and the SHELL around it both read the router unconditionally, and
// a plain RTL render is not an App Router tree. `SEARCH` is set by the wrapper
// below so the shell reads the same query string the island was handed.
let SEARCH = ""
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/dashboard/pnl",
  useSearchParams: () => new URLSearchParams(SEARCH),
}))

import { AppShell } from "@/components/counter"
import { CounterPnlClient as PnlIsland } from "@/app/dashboard/(counter)/pnl/counter-pnl-client"

/**
 * The page as its LAYOUT composes it — `AppShell` is
 * `src/app/dashboard/(counter)/layout.tsx`'s now.
 */
function CounterPnlClient(props: React.ComponentProps<typeof PnlIsland>) {
  SEARCH = props.params
  return (
    <AppShell stores={props.stores} user={USER} today={props.today}>
      <PnlIsland {...props} />
    </AppShell>
  )
}

/** The rail's account row — the layout's now, not the page's. */
const USER = { name: "Chris Karimian", role: "Owner" }
import { ready, empty, failed } from "@/lib/counter/section-data"
import { trailingWeeks, serializeWeekWindow } from "@/lib/counter/date-range"
import type { PnlSections } from "@/lib/counter/adapters/pnl"
import { plainFixture } from "./fixtures/pnl-plain"

const TODAY = new Date("2026-08-25T00:00:00-07:00") // Tuesday in Los Angeles
const WEEKS = trailingWeeks(TODAY, 8)

const base = {
  // Plain text, never a URLSearchParams instance — see the island's own note.
  params: "",
  stores: [
    { id: "hollywood", name: "Hollywood", stage: "trading" as const },
    { id: "glendale", name: "Glendale", stage: "pre_open" as const },
  ],
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


const PLAIN = plainFixture(WEEKS)

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
      window: serializeWeekWindow(w),
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
  plain: ready(PLAIN),
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
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    expect(screen.getByRole("heading", { level: 2, name: "Profit and loss" })).toBeTruthy()
    expect(container.querySelector(".pagehead .sub")?.textContent).toBe(
      "All stores · Aug 24 · 1 day · vs the prior period",
    )
    expect(screen.getByRole("navigation", { name: /breadcrumb/i }).textContent).toBe(
      "All stores/P&L",
    )
  })

  it("leads with what was kept, says it is an upper bound when labor is missing, and how it moved", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const big = container.querySelector(".pl-big")?.textContent
    expect(big).toBe("≤ $23,916" + "28.4% of sales")
    expect(container.querySelector(".pl-atmost")?.textContent).toBe("at most · 2 Glendale days of labor missing")
    expect(container.querySelector(".pl-delta")?.textContent).toContain("vs Oct 19 – 25: ▲ +$4,413")
    expect(container.querySelector(".pl-lead")?.textContent).toContain("true number is lower")
    expect(Array.from(container.querySelectorAll(".pl-pill")).map((p) => p.className)).toEqual([
      "pl-pill ",
      "pl-pill is-bad",
    ])
  })

  it("composes the page: kept, Needs you, the dollar, day by day, by store, then the full statement", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const titles = Array.from(main(container).querySelectorAll(".sec .sec__head h3, .sec summary h3")).map(
      (h) => h.textContent,
    )
    expect(titles).toEqual([
      "Needs you",
      "Where each dollar went",
      "Day by day",
      "By store",
      "Full statement",
    ])
  })

  it("folds Needs you and the full statement closed", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const folds = Array.from(main(container).querySelectorAll("details"))
    expect(folds.length).toBeGreaterThanOrEqual(2)
    for (const d of folds) expect(d.open).toBe(false)
    expect(screen.getByText("Labor is missing")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Open store settings" }).getAttribute("href")).toBe(
      "/dashboard/stores/glendale",
    )
  })

  it("presses a week bar and moves the range to that week", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const bars = container.querySelectorAll(".pl-wk button")
    expect(bars).toHaveLength(8)
    expect(bars[7].querySelector(".pl-bar")?.className).toContain("is-part")
    fireEvent.click(bars[2])
    const w = WEEKS[2]
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    expect(push).toHaveBeenCalledWith(`/dashboard/pnl?from=${iso(w.start)}&to=${iso(w.end)}`, { scroll: false })
  })

  it("marks the week the page is reading, and only that one", () => {
    const w = WEEKS[3]
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const { container } = render(
      <CounterPnlClient {...base} params={`from=${iso(w.start)}&to=${iso(w.end)}`} sections={sections} />,
    )
    const on = container.querySelectorAll('.pl-wk button[aria-pressed="true"]')
    expect(on).toHaveLength(1)
    expect(on[0]).toBe(container.querySelectorAll(".pl-wk button")[3])
  })

  it("opens a day into its lines and its stores, marking an incomplete one 'at most'", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const days = container.querySelectorAll("button.pl-day")
    expect(days).toHaveLength(2)
    expect(days[1].textContent).toContain("Glendale labor missing · kept is at most")
    expect(days[1].textContent).toContain("≤ $2,364")
    expect(container.querySelector(".pl-detail")).toBeNull()
    fireEvent.click(days[1])
    const detail = container.querySelector(".pl-detail") as HTMLElement
    expect(within(detail).getByText("Kept (at most)")).toBeTruthy()
    expect(within(detail).getByText("no labor this day")).toBeTruthy()
    fireEvent.click(days[1])
    expect(container.querySelector(".pl-detail")).toBeNull()
  })

  it("presses a store card and scopes the page to it", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const cards = container.querySelectorAll("button.pl-store")
    expect(cards).toHaveLength(2)
    expect(cards[1].textContent).toContain("2 days of labor missing")
    fireEvent.click(cards[0])
    expect(push).toHaveBeenCalledWith("/dashboard/pnl?store=hollywood", { scroll: false })
  })

  it("heads the full statement's comparison column with the comparison, and calls out only the loud lines", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const table = container.querySelectorAll("table.tbl")[0] as HTMLElement
    expect(Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent)).toEqual([
      "Line", "This range", "% of sales", "the prior period", "Change", "Worth",
    ])
    expect(table.querySelectorAll("tbody tr")).toHaveLength(9)
    const hot = table.querySelectorAll("td.hot")
    expect(hot).toHaveLength(1)
    expect(hot[0].textContent).toBe("▲ 1.3 pts")
  })

  it("gives every statement row that has a destination one this app actually serves", () => {
    const { container } = render(<CounterPnlClient {...base} sections={sections} />)
    const table = container.querySelectorAll("table.tbl")[0] as HTMLElement
    const links = Array.from(table.querySelectorAll("tbody tr[role='link']"))
    expect(links).toHaveLength(5)
    fireEvent.click(links[0])
    expect(push).toHaveBeenCalledWith("/dashboard/analytics")
  })

  it("carries each section's own state — the plain reading failing does not blank the statement", () => {
    const { container } = render(
      <CounterPnlClient {...base} sections={{ ...sections, plain: failed("the rollup timed out", "retryStatement") }} />,
    )
    expect(container.querySelector(".pl-big")).toBeNull()
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)
    expect(container.querySelectorAll("table.tbl")).toHaveLength(1)
  })

  it("renders the empty reason rather than a page of zeroes", () => {
    const { container } = render(
      <CounterPnlClient
        {...base}
        sections={{ ...sections, plain: empty("pre_open"), statement: empty("pre_open") }}
      />,
    )
    expect(container.querySelector(".pl-big")).toBeNull()
    expect(container.querySelectorAll(".empty").length).toBeGreaterThan(0)
  })
})
