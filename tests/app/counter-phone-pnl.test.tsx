// @vitest-environment jsdom
/**
 * The P&L's phone composition, asserted against `P.pnl.phone()`'s own order
 * (`docs/counter/counter-prototype.html:5354`).
 *
 * `npm run fidelity` measures the same thing in a browser against the
 * prototype itself. These are the fast half — and they also cover the two
 * things that gate cannot see:
 *
 *  - **`.mtop`.** The fidelity phone surface is `#phoneHost .pframe .mscroll`,
 *    so the store selector and the date sheet are outside everything it
 *    compares. That is how a phone-only reader ended up unable to change the
 *    store, the range or the comparison on a page that reads all three from
 *    the URL, with every gate in this repo green.
 *  - **Where a week row GOES.** A landmark count cannot tell a row that sets
 *    this page's range from a row that sets someone else's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, fireEvent, within } from "@testing-library/react"

const push = vi.fn()
// The SHELL around the island reads the URL directly now. `SEARCH` is set by
// `renderPhone` so it sees the same query string the page was rendered for.
let SEARCH = ""
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/m/pnl",
  useSearchParams: () => new URLSearchParams(SEARCH),
}))

import { PhoneShell } from "@/components/counter"
import { CounterPhonePnlClient } from "@/app/(mobile)/m/(counter)/pnl/counter-phone-pnl-client"
import { ready, failed } from "@/lib/counter/section-data"
import { trailingWeeks } from "@/lib/counter/date-range"
import { PRIME_CEILING_PCT } from "@/lib/counter/prime-cost"
import type { PnlSections } from "@/lib/counter/adapters/pnl"

const TODAY = new Date(2026, 7, 25) // Tuesday 25 Aug 2026
const WEEKS = trailingWeeks(TODAY, 8)

const STORES = [
  { id: "holly", name: "Hollywood", stage: "trading" as const },
  { id: "gln", name: "Glendale", stage: "pre_open" as const },
]

/**
 * 25,879 − 4,632 − 8,120 − 6,540 − 2,100 − 1,240 = 3,247, so the cascade's
 * printed end is the component's arithmetic rather than a fixture agreeing
 * with itself.
 */
const CASCADE = {
  start: { name: "Gross sales", sub: "1,024 orders", amount: 25_879 },
  cuts: [
    { name: "Marketplace commissions", sub: "3 marketplaces", amount: 4_632 },
    { name: "Food", sub: "against a 29.0% target", amount: 8_120, over: true },
    { name: "Labor", sub: "clock-ins where Harri covers", amount: 6_540 },
    { name: "Occupancy", sub: "rent, prorated across 7 days", amount: 2_100 },
    { name: "Other operating", sub: "towels, cleaning and custom fixed lines", amount: 1_240 },
  ],
  end: { name: "Bottom line", sub: "12.5% of sales" },
}

/** The eight weeks the adapter loads. The seventh is over the ceiling. */
const WEEK_ROWS = WEEKS.map((w, i) => ({
  window: w,
  grossSales: 20_000 + i * 500,
  cogsPct: 31.4,
  laborPct: 24.8,
  primePct: i === 6 ? PRIME_CEILING_PCT + 2 : 56.2,
  bottomLine: 2_500 + i * 100,
  marginPct: 12.5,
}))

const sections: PnlSections = {
  headline: ready({
    // The DESK's five. Nothing on this page may read them — the phone's prime
    // cell says something different about the same figure.
    cells: [
      { label: "Bottom line", value: "$3,247", delta: "12.5% of sales" },
      { label: "Prime cost", value: "56.2%", delta: "▲ 1.4 pts vs prior", caption: "Ceiling 60.0%" },
      { label: "Food", value: "31.4%", caption: "Target 29.0%" },
      { label: "Labor", value: "24.8%", caption: "$6,540" },
      { label: "Gross sales", value: "$25,879", delta: "▲ 4.1% vs the prior period" },
    ],
    phoneCells: [
      { label: "Bottom line", value: "$3,247", delta: "12.5% of sales" },
      {
        label: "Prime cost",
        value: "56.2%",
        delta: "3.8 pts of room",
        reference: { v: 56.2, target: 60, better: "low", label: "Prime cost 56.2%" },
      },
    ],
    reading: [{ text: "You kept $3,247", strong: true }, { text: " of $25,879." }],
  }),
  cascade: ready(CASCADE),
  weeks: ready({ rows: WEEK_ROWS, foodTargetPct: 29 }),
  statement: ready({
    comparisonLabel: "the prior period",
    fixedInRange: "$3,340",
    lines: [
      { key: "gross", name: "Gross sales", strong: true, amount: "$25,879", share: "100.0%", comparison: "$24,860", change: "▲ 4.1%", loud: false, worth: "+$1,019" },
      { key: "commissions", name: "Marketplace commissions", amount: "−$4,632", share: "17.9%", comparison: "17.4%", change: "▲ 0.5 pts", loud: false, worth: "+$129" },
      { key: "net", name: "Net revenue", strong: true, amount: "$21,247", share: "82.1%", comparison: "82.6%", change: "▼ 0.5 pts", loud: false, worth: "−$129" },
      { key: "food", name: "Food", sub: "target 29.0%", amount: "−$8,120", share: "31.4%", comparison: "30.1%", change: "▲ 1.3 pts", loud: true, over: true, worth: "+$336" },
      { key: "labor", name: "Labor", amount: "−$6,540", share: "25.3%", comparison: "24.9%", change: "▲ 0.4 pts", loud: false, worth: "+$104" },
      { key: "prime", name: "Prime cost", strong: true, amount: "$14,660", share: "56.7%", comparison: "55.0%", change: "▲ 1.7 pts", loud: false, worth: "+$440" },
      { key: "occupancy", name: "Occupancy", amount: "−$2,100", share: "8.1%", comparison: "8.4%", change: "▼ 0.3 pts", loud: false, worth: "−$78" },
      { key: "other", name: "Other operating", amount: "−$1,240", share: "4.8%", comparison: "4.6%", change: "▲ 0.2 pts", loud: false, worth: "+$52" },
      { key: "bottom", name: "Bottom line", strong: true, amount: "$3,247", share: "12.5%", comparison: "13.6%", change: "▼ 1.1 pts", loud: false, worth: "−$285" },
    ],
  }),
  byStore: ready([
    { id: "holly", name: "Hollywood", stage: "trading", grossSales: 25_879, primePct: 56.2, fixedOnFile: 2_100, rentOnFile: true },
  ]),
  trust: { status: "not_computed", owed: "a per-line provenance model" },
  foodCause: { status: "not_computed", owed: "a cause-attribution model" },
}

/**
 * The page as its LAYOUT composes it. `.ct-root.ct-phone`, `.mtop` and
 * `.mscroll` moved out of this island into
 * `src/app/(mobile)/m/(counter)/layout.tsx`, so a test rendering the island
 * alone would be asserting against half a page.
 */
function renderPhone(params = "", over: Partial<PnlSections> = {}) {
  push.mockClear()
  SEARCH = params
  return render(
    <PhoneShell stores={STORES} today={TODAY}>
      <CounterPhonePnlClient params={params} today={TODAY} sections={{ ...sections, ...over }} />
    </PhoneShell>,
  )
}

const scroll = (c: HTMLElement) => c.querySelector(".mscroll") as HTMLElement

/** The landmark classes the fidelity gate counts, in the order they render. */
const LANDMARKS = [
  "mstrip",
  "mlist",
  "moneyline",
  "sec",
  "sec__head",
  "sec__body",
  "wf",
  "blt",
  "band",
  "mhead",
  "strip",
  "sp",
  "tbl",
  "wkt",
]

function landmarkSequence(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*"))
    .map((el) => LANDMARKS.filter((c) => el.classList.contains(c)).join("."))
    .filter(Boolean)
}

beforeEach(() => push.mockClear())

describe("Counter P&L — the phone", () => {
  it("puts .ct-root and .ct-phone ABOVE .mscroll, so .mtop is inside the token root", () => {
    const { container } = renderPhone()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toBe("ct-root ct-phone")
    expect([...root.children].map((c) => c.className)).toEqual(["mtop", "mscroll"])
  })

  it("composes the page in `P.pnl.phone()`'s order", () => {
    // mstrip → cascade section → week section → statement section, and NOT the
    // desk's `.strip`, `.sp`, `.wkt` or `.tbl`.
    const { container } = renderPhone()
    expect(landmarkSequence(scroll(container))).toEqual([
      "mstrip",
      "blt",
      "band",
      "sec",
      "sec__head",
      "sec__body",
      "wf",
      "sec",
      "sec__head",
      "sec__body",
      "mlist",
      "sec",
      "sec__head",
      "sec__body",
      "moneyline",
      "moneyline",
      "moneyline",
      "moneyline",
      "moneyline",
      "moneyline",
      "moneyline",
    ])
  })

  it("heads the page with its NAME and subs it with the window and the day count", () => {
    // Not the store: `.mtop`'s `.st` is showing that one element up, and not
    // the Overview's sentence about the range — a statement is the same
    // document whatever window it is drawn over.
    const { container } = renderPhone("?from=2026-08-17&to=2026-08-23")
    expect(container.querySelector(".mtitle")?.textContent).toBe("Profit and loss")
    expect(container.querySelector(".msub")?.textContent).toBe("Aug 17 – Aug 23 · 7 days")
  })

  it("names the window by its ENDS on a preset too, never by the preset's name", () => {
    // `CD.rangeLabel()` is `fmtRange()` — two dates, no preset branch. With
    // the preset's name here the sub reads "Last 7 days · 7 days", which says
    // the same thing twice and never says WHICH seven days. The two section
    // metas take the same label and have the same problem.
    const { container } = renderPhone("?range=d7")
    expect(container.querySelector(".msub")?.textContent).toBe("Aug 19 – Aug 25 · 7 days")
    expect(
      Array.from(container.querySelectorAll(".sec__head .k")).map((e) => e.textContent),
    ).toEqual(["Aug 19 – Aug 25", "tap a week", "Aug 19 – Aug 25"])
  })

  /* ── The strip ─────────────────────────────────────────────────────── */

  it("draws the PHONE's two cells, not the first two of the desk's five", () => {
    const { container } = renderPhone()
    const strip = container.querySelector(".mstrip") as HTMLElement
    expect(Array.from(strip.querySelectorAll(".k")).map((e) => e.textContent)).toEqual([
      "Bottom line",
      "Prime cost",
    ])
    // The desk's prime cell says "▲ 1.4 pts vs prior"; the phone's says how
    // much ceiling is left. Reading `cells` instead of `phoneCells` would put
    // the desk's sentence here and nothing else would notice.
    expect(strip.textContent).toContain("3.8 pts of room")
    expect(strip.textContent).not.toContain("vs prior")
  })

  it("draws no sparkline on the phone, whatever the reference carries", () => {
    // `mstrip()`'s own decision: the phone takes the mark, not the trajectory.
    const { container } = renderPhone("", {
      headline: ready({
        ...(sections.headline.status === "ready" ? sections.headline.data : ({} as never)),
        phoneCells: [
          { label: "Bottom line", value: "$3,247" },
          {
            label: "Prime cost",
            value: "56.2%",
            reference: { v: 56.2, target: 60, better: "low", series: [55, 56, 57] },
          },
        ],
      }),
    })
    expect(container.querySelectorAll(".sp")).toHaveLength(0)
    expect(container.querySelectorAll(".blt")).toHaveLength(1)
  })

  /* ── The six weeks ─────────────────────────────────────────────────── */

  it("lists SIX weeks — the most recent six, oldest first", () => {
    const { container } = renderPhone()
    const rows = container.querySelectorAll(".mli")
    expect(rows).toHaveLength(6)
    // The eight the adapter loads, less the two oldest — so the first row is
    // WEEKS[2], not WEEKS[0]. Reading the first six instead would put six
    // stale weeks under a heading that says the last six.
    const first = WEEKS[2]
    expect(first.start.toDateString()).toBe("Mon Jul 20 2026")
    expect(rows[0].querySelector("b")?.textContent).toBe("Jul 20")
  })

  it("says how short a part-week is, rather than drawing it as a whole one", () => {
    const { container } = renderPhone()
    const rows = container.querySelectorAll(".mli")
    const last = WEEKS[WEEKS.length - 1]
    expect(last.partial, "the fixture's last week must be short for this to mean anything").toBe(true)
    expect(rows[5].querySelector("b")?.textContent).toBe(
      `Aug ${last.start.getDate()} · ${last.days}d`,
    )
  })

  it("prints each week's own gross, prime, kept and margin", () => {
    const { container } = renderPhone()
    const row = container.querySelectorAll(".mli")[0]
    expect(row.querySelector("div > span")?.textContent).toBe("$21,000 · prime 56.2%")
    expect(row.querySelector(".rt")?.textContent).toBe("$2,70012.5%")
  })

  it("calls a week down when its PRIME cost beat the ceiling, not when its margin was small", () => {
    const { container } = renderPhone()
    const rows = container.querySelectorAll(".mli")
    // Every week's margin is 12.5% in the fixture; only WEEK_ROWS[6] is over
    // the ceiling, and it is the fifth of the six shown.
    expect(Array.from(rows).map((r) => r.querySelector("em")?.className)).toEqual([
      "up", "up", "up", "up", "down", "up",
    ])
  })

  it("makes a week a LINK to its own window, on this page", () => {
    const { container } = renderPhone("?cmp=weekday")
    const row = container.querySelectorAll(".mli")[0] as HTMLAnchorElement
    expect(row.tagName).toBe("A")
    const url = new URL(row.getAttribute("href")!, "http://x")
    expect(url.pathname).toBe("/m/pnl")
    // The row's OWN window — never a preset, and never the window the page is
    // already reading. The comparison it was opened with survives.
    expect(url.searchParams.get("from")).toBe("2026-07-20")
    expect(url.searchParams.get("to")).toBe("2026-07-26")
    expect(url.searchParams.get("cmp")).toBe("weekday")
    expect(url.searchParams.get("range")).toBeNull()
  })

  /* ── The statement ─────────────────────────────────────────────────── */

  it("prints the prototype's SEVEN lines, dropping the two subtotals the desk keeps", () => {
    const { container } = renderPhone()
    const lines = container.querySelectorAll(".moneyline")
    expect(Array.from(lines).map((l) => l.querySelector("span")?.textContent)).toEqual([
      "Gross sales",
      "Commissions",
      "Food",
      "Labor",
      "Occupancy",
      "Other operating",
      "Bottom line",
    ])
    // "Net revenue" and "Prime cost" only mean something beside a change
    // column, and the phone has none.
    expect(container.textContent).not.toContain("Net revenue")
  })

  it("prints the amounts the ADAPTER formatted, minus signs and all", () => {
    const { container } = renderPhone()
    const values = Array.from(container.querySelectorAll(".moneyline")).map(
      (l) => l.querySelectorAll("span")[1]?.textContent,
    )
    expect(values).toEqual([
      "$25,879",
      "−$4,632",
      "−$8,120",
      "−$6,540",
      "−$2,100",
      "−$1,240",
      "$3,247",
    ])
  })

  it("heavies the bottom line and paints the food line the adapter judged over", () => {
    const { container } = renderPhone()
    const lines = Array.from(container.querySelectorAll(".moneyline"))
    expect(lines[6].className).toBe("moneyline total")
    expect(lines.filter((l) => l.className === "moneyline total")).toHaveLength(1)
    const painted = lines
      .map((l) => l.querySelectorAll("span")[1] as HTMLElement)
      .map((s) => s.style.color)
    expect(painted).toEqual([
      "", "var(--bad)", "var(--bad)", "", "", "", "",
    ])
  })

  it("leaves the food line unpainted when the adapter did not judge it over", () => {
    // `over` is the adapter's judgement against a target on file. This page
    // never compares a percentage to one — if it did, an account with no
    // target would get a red line drawn against nothing.
    const readyStatement =
      sections.statement.status === "ready" ? sections.statement.data : ({} as never)
    const { container } = renderPhone("", {
      statement: ready({
        ...readyStatement,
        lines: readyStatement.lines.map((l) =>
          l.key === "food" ? { ...l, over: undefined } : l,
        ),
      }),
    })
    const food = Array.from(container.querySelectorAll(".moneyline")).find((l) =>
      l.textContent?.startsWith("Food"),
    ) as HTMLElement
    expect((food.querySelectorAll("span")[1] as HTMLElement).style.color).toBe("")
  })

  it("says what the fixed lines were charged for THIS range, not a whole month", () => {
    const { container } = renderPhone("?from=2026-08-17&to=2026-08-23")
    expect(container.querySelector("p.mono")?.textContent).toBe(
      "Rent and the other monthly lines are charged at $3,340 for these 7 days, not a whole month.",
    )
  })

  /* ── The chrome the fidelity gate cannot see ───────────────────────── */

  it("renders the store and the date controls a phone-only reader needs", () => {
    const { container } = renderPhone()
    const top = container.querySelector(".mtop") as HTMLElement
    expect(top.querySelector(".st")?.tagName).toBe("BUTTON")
    expect(top.querySelector(".mdate")?.tagName).toBe("BUTTON")
  })

  it("the store control writes ?store on THIS page — the same parameter the desk writes", () => {
    const { container } = renderPhone()
    fireEvent.click(container.querySelector(".st")!)
    const sheet = document.getElementById(
      container.querySelector(".st")!.getAttribute("aria-controls")!,
    )!
    fireEvent.click(within(sheet).getByText("Hollywood"))
    expect(push).toHaveBeenCalledWith("/m/pnl?store=holly", { scroll: false })
  })

  /* ── One section's failure is not another's ────────────────────────── */

  it("keeps the strip and the statement when the WEEKS fail", () => {
    // The weeks are their own load. A page that went blank because six rows
    // could not be drawn would be a worse page than one missing six rows.
    const { container } = renderPhone("", {
      weeks: failed("the weekly rollups are down", "retryWeeks"),
    })
    expect(container.querySelectorAll(".mstrip")).toHaveLength(1)
    expect(container.querySelectorAll(".moneyline")).toHaveLength(7)
    expect(container.querySelectorAll(".mlist")).toHaveLength(0)
    expect(container.textContent).toContain("the weekly rollups are down")
  })
})
