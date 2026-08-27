// @vitest-environment jsdom
/**
 * The desk composition, asserted against `P.overview.desk()`'s own order
 * (`docs/counter/counter-prototype.html:4219`).
 *
 * The fidelity gate measures the same thing in a browser, against the
 * prototype itself. These tests are the fast half: they hold the ORDER and the
 * two structural rules that break the layout silently, so a regression is a
 * red suite in nine seconds rather than a red Playwright run.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"

/*
 * Both the island and the SHELL around it call `useRouter()` / `usePathname()`
 * / `useSearchParams()` unconditionally. Outside a real Next.js App Router
 * tree — which is exactly what a plain RTL render is — those throw an
 * invariant. None of these tests clicks a control, so a no-op push is enough;
 * `SEARCH` is set by the wrapper below so the shell reads the same query
 * string the island was handed, exactly as they do in the browser.
 */
let SEARCH = ""
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(SEARCH),
}))

import { AppShell } from "@/components/counter"
import { CounterOverviewClient as OverviewIsland } from "@/app/dashboard/(counter)/counter-overview-client"

/**
 * The page as its LAYOUT composes it. `AppShell` moved out of this island into
 * `src/app/dashboard/(counter)/layout.tsx`, so a test that rendered the island
 * alone would be asserting against half a page — and every assertion below
 * about `main#ct-main`, `.crumbs` or the rail's store popover would be
 * measuring something the browser never renders.
 */
function CounterOverviewClient(props: React.ComponentProps<typeof OverviewIsland>) {
  SEARCH = props.params
  return (
    <AppShell stores={props.stores} user={USER} today={props.today}>
      <OverviewIsland {...props} />
    </AppShell>
  )
}

/** The rail's account row — the layout's now, not the page's. */
const USER = { name: "Chris Karimian", role: "Owner" }
import { ready, failed, notComputed, empty } from "@/lib/counter/section-data"
import type { OverviewSections } from "@/lib/counter/adapters/overview"

const base = {
  // A plain query string, not a URLSearchParams instance — see the
  // component's own doc comment on why (RSC serialisation strips a class
  // instance's prototype; a real browser catches this, a unit test that
  // constructs the component directly does not).
  params: "",
  stores: [{ id: "hollywood", name: "Hollywood", stage: "trading" as const }],
  today: new Date(2026, 7, 25),
}

const sections: OverviewSections = {
  sales: ready({ grossSales: 7468, comparison: "▲ 4.1% vs the prior period" }),
  splh: ready({ value: 71.4, floor: null, series: [68, 70, 71.4] }),
  strip: ready([
    { label: "Orders", value: "1,024" },
    { label: "Avg ticket", value: "$25.66" },
  ]),
  verdict: ready({
    tone: "bad",
    headline: "One figure is over",
    body: "Food cost is 31.4% against plan 29.0%.",
    action: { label: "Show me which items", href: "/dashboard/cogs" },
  }),
  moving: ready([{ label: "Range", value: "1 days", note: "1 daily buckets · no comparison" }]),
  needsYou: ready([
    {
      key: "a1",
      tone: "bad",
      lead: "3",
      unit: "days open",
      title: "Invoice lines that do not reconcile",
      body: "Extracted lines fall short of the header total.",
      href: "/dashboard/alerts",
      actLabel: "Open in the queue",
    },
  ]),
  salesChart: ready({ labels: ["Mon"], series: [{ name: "Net sales", color: "var(--ink)", data: [7468] }] }),
  splhChart: ready({ labels: ["Mon"], series: [{ name: "SPLH", color: "var(--ink)", data: [71.4] }] }),
  stores: ready([
    {
      kind: "trading",
      id: "hollywood",
      name: "Hollywood",
      stage: "trading",
      grossSales: 7468,
      series: [7468],
      comparison: "no comparison set",
      orders: 291,
      ticket: 25.66,
      salesPerHour: 71.4,
      channels: [{ id: "house", net: 4000, orders: 160 }],
    },
    {
      kind: "pre_open",
      id: "glendale",
      name: "Glendale",
      opensOn: null,
      missingFromFile: ["Rent"],
    },
  ]),
  comparison: ready([
    { key: "net", figure: "Net sales", now: "$7,468", then: "$7,170", change: "▲ 4.1%", bad: false },
    { key: "food", figure: "Food cost", now: "31.4%", then: "30.1%", change: "▲ 1.3 pts", bad: true },
  ]),
  channels: ready([{ channel: "house", net: 4000, orders: 160, commission: 0, ticket: 25 }]),
  invoices: ready([
    { label: "Received", value: "34 · $63,203" },
    { label: "In review", value: "6 · $2,140", tone: "warn" },
    { label: "Posted to COGS", value: "28 · $61,063", total: true },
  ]),
  modelCall: notComputed("the model's call for this day"),
  ratings: ready({ average: "4.6", count: 142, windowDays: 30, lowCount: 1 }),
}

/** Every landmark class the fidelity gate reads, in DOM order. */
function landmarks(container: HTMLElement): string[] {
  const CLASSES = [
    "dispatch", "headline", "fig", "say", "hfloor", "strip", "sec", "moving",
    "askbar", "sugs", "sug", "queue", "qitem", "stores", "stcard", "chan",
    "chan__row", "cbar", "ch", "drill", "tbl", "blt", "sp", "band",
    "sec__head", "sec__body", "btnrow", "btn", "empty", "moneyline",
  ]
  const main = container.querySelector("main#ct-main") as HTMLElement
  return Array.from(main.querySelectorAll("*"))
    .map((el) => CLASSES.filter((c) => el.classList.contains(c)).join("."))
    .filter((s) => s !== "")
}

describe("Counter Overview", () => {
  it("titles the page with the WINDOW, and leaves its name to the breadcrumb", () => {
    // The prototype's `P.overview.title()` is a function of the range, not the
    // page's name (line 4217). With no `range` param the default preset is
    // "yesterday" — one day, Monday 24 Aug 2026.
    render(<CounterOverviewClient {...base} sections={sections} />)
    expect(screen.getByRole("heading", { level: 2, name: "Monday's numbers" })).toBeTruthy()
    // `crumbs()` always opens with a store; with no `store` param that is the
    // aggregate, which the prototype carries as an "All stores" pseudo-store.
    expect(screen.getByRole("navigation", { name: /breadcrumb/i }).textContent).toBe(
      "All stores/Overview",
    )
  })

  it("subtitles it with the store, the window and what it is measured against", () => {
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    expect(container.querySelector(".pagehead .sub")?.textContent).toBe(
      "All stores · Aug 24 · vs the prior period",
    )
  })

  it("composes the page in the prototype's order, with five blocks OUTSIDE any section", () => {
    // This is the whole task, as one assertion. The head block, the strip, the
    // moving band, the ask bar and the comparison drill sit at page level —
    // above and between the six sections — and everything below the split is
    // in the order `P.overview.desk()` writes it.
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    const main = container.querySelector("main#ct-main") as HTMLElement
    const kids = [...main.children].map((c) => c.className.split(" ")[0])
    expect(kids).toEqual([
      "pagehead",
      "dispatch",
      "headline",
      "strip",
      "moving",
      "askbar",
      "split",
      "drill",
      "sec", // what needs you
      "sec", // per-store ledger
      "tri",
    ])
    for (const cls of [".headline", ".strip", ".moving", ".askbar", ".drill"]) {
      expect(main.querySelector(cls)!.closest(".sec")).toBeNull()
    }
  })

  it("renders the landmark sequence the fidelity gate reads, and renders it in order", () => {
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    const seq = landmarks(container)
    // The head block first, then the strip, then the moving band — never a
    // `.sec` before any of them.
    expect(seq.indexOf("dispatch")).toBeLessThan(seq.indexOf("headline"))
    expect(seq.indexOf("headline")).toBeLessThan(seq.indexOf("strip"))
    expect(seq.indexOf("strip")).toBeLessThan(seq.indexOf("moving"))
    expect(seq.indexOf("moving")).toBeLessThan(seq.indexOf("askbar"))
    expect(seq.indexOf("askbar")).toBeLessThan(seq.indexOf("sec"))
    // The drill sits between the chart pair and the queue.
    expect(seq.indexOf("drill")).toBeLessThan(seq.lastIndexOf("queue"))
    // And the cards come before their drawers' panels.
    expect(seq.lastIndexOf("stcard")).toBeLessThan(seq.indexOf("chan"))
    // Nothing is rendered as a grey "empty" box on a page with data.
    expect(seq).not.toContain("empty")
  })

  it("puts the dispatch line at PAGE level, above every section — never inside one", () => {
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    const main = container.querySelector("main#ct-main") as HTMLElement
    const dispatch = main.querySelector(".dispatch") as HTMLElement
    expect(dispatch.parentElement).toBe(main)
    expect(dispatch.closest(".sec")).toBeNull()
  })

  it("leads with two figures and a verdict, in one head block", () => {
    // Note 30: net sales says whether the day happened, sales per labour hour
    // says whether it was worth having.
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    const head = container.querySelector(".headline") as HTMLElement
    expect(head.className).toBe("headline headline--duo")
    expect([...head.children].map((c) => c.className)).toEqual(["fig", "fig fig--co", "say"])
    expect(head.querySelectorAll(".fig")[0].querySelector(".v")!.textContent).toBe("$7,468")
    expect(head.querySelectorAll(".fig")[1].querySelector(".v")!.textContent).toBe("$71.40")
    expect(head.querySelector(".say .state")!.textContent).toBe("One figure is over")
  })

  it("draws NO floor meter, because no store file publishes a floor", () => {
    // `SPLH_FLOOR = 68.00` is the prototype's own invention and
    // `SplhPoint.targetSplh` is the figure judging itself. A meter against a
    // number nobody set is worse than no meter.
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    expect(container.querySelector(".hfloor")).toBeNull()
    expect(container.querySelector(".blt--lead")).toBeNull()
  })

  it("draws the floor meter the moment a floor IS published", () => {
    const { container } = render(
      <CounterOverviewClient
        {...base}
        sections={{ ...sections, splh: ready({ value: 71.4, floor: 68, series: [70, 71.4] }) }}
      />,
    )
    expect(container.querySelector(".fig--co .blt--lead")).toBeTruthy()
    expect(container.querySelector(".fig--co .hfloor")!.textContent).toContain("Floor $68.00")
  })

  it("each head figure carries its OWN state — one rollup failing does not blank the other", () => {
    // `sales` and `splh` come from different rollups that fail independently,
    // which is why they are two sections rather than one.
    const { container } = render(
      <CounterOverviewClient
        {...base}
        sections={{ ...sections, splh: failed("SPLH rollup timed out", "retrySplh") }}
      />,
    )
    const head = container.querySelector(".headline") as HTMLElement
    expect(head.querySelectorAll(".fig")[0].querySelector(".v")!.textContent).toBe("$7,468")
    expect(within(head as HTMLElement).getByRole("alert")).toBeTruthy()
  })

  it("mounts no comparison drill at all when the comparison is off", () => {
    // `P.overview.desk()`'s own `cmpOn &&` (line 4340). This is page state, not
    // a section's status — a drawer promising a comparison that was switched
    // off is note 19's lie.
    const { container } = render(
      <CounterOverviewClient {...base} params="cmp=none" sections={sections} />,
    )
    expect(container.querySelector(".drill")).toBeNull()
    expect(container.querySelector(".tbl")).toBeNull()
  })

  it("puts the comparison table inside a wide drill, under the charts", () => {
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    const drill = container.querySelector(".drill") as HTMLElement
    expect(drill.className).toBe("drill drill--wide")
    expect(drill.querySelector(".tbl")).toBeTruthy()
    // A change that went the wrong way wears the prototype's own `hot` class.
    expect(drill.querySelector("td.hot")!.textContent).toBe("▲ 1.3 pts")
  })

  it("replaces the four-column ledger with cards, and gives each card a channel panel", () => {
    // Note 33. The table this page used to draw printed `$0`, `0.0%` and an
    // em-dash for every store that had not opened.
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    expect(container.querySelectorAll(".stores > .stcard")).toHaveLength(2)
    expect(container.querySelectorAll(".stores > .ldrawer")).toHaveLength(2)
    expect(container.querySelectorAll(".chan")).toHaveLength(2)
    // Hollywood's panel has channel rows; Glendale's has none and says why.
    expect(container.querySelectorAll(".chan__row")).toHaveLength(1)
    expect(screen.getByText("Glendale is not trading yet")).toBeTruthy()
  })

  it("gives every panel somewhere to go, and every destination is a route this app serves", () => {
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    const hrefs = Array.from(container.querySelectorAll(".chan .btnrow a")).map((a) =>
      a.getAttribute("href"),
    )
    expect(hrefs).toEqual([
      "/dashboard/pnl/hollywood",
      "/dashboard/stores/hollywood",
      "/dashboard/stores/glendale",
    ])
  })

  it("writes the invoices as money lines and the ratings beside them, two to a row", () => {
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    const tri = container.querySelector(".tri") as HTMLElement
    expect(tri.className).toBe("tri tri--2")
    expect(tri.querySelectorAll(".moneyline")).toHaveLength(3)
    expect(tri.querySelector(".stars .n")!.textContent).toBe("4.6")
  })

  it("says which stores are trading, because that is why a figure below may be empty", () => {
    render(<CounterOverviewClient {...base} sections={sections} />)
    expect(screen.getByText("1 of 1 stores trading")).toBeTruthy()
  })

  it("says a pre-open store is not trading, rather than leaving an empty page unexplained", () => {
    render(
      <CounterOverviewClient
        {...base}
        params="store=glendale"
        stores={[
          { id: "hollywood", name: "Hollywood", stage: "trading" as const },
          { id: "glendale", name: "Glendale", stage: "pre_open" as const },
        ]}
        sections={sections}
      />,
    )
    expect(screen.getAllByText(/Glendale is not trading yet/).length).toBeGreaterThan(0)
  })

  it("does not offer the queue link the prototype does — /dashboard/needs-you is not served yet", () => {
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    expect(container.querySelector(".dispatch .go")).toBeNull()
  })

  it("names owed sections instead of showing a zero", () => {
    render(
      <CounterOverviewClient
        {...base}
        sections={{ ...sections, needsYou: notComputed("alerts and decisions queue") }}
      />,
    )
    expect(screen.getByText(/alerts and decisions queue/)).toBeTruthy()
    expect(screen.queryByText("$0")).toBeNull()
  })

  it("renders a failed section as a failure and keeps the rest of the page", () => {
    render(
      <CounterOverviewClient
        {...base}
        sections={{ ...sections, sales: failed("Otter sync timed out", "retrySync") }}
      />,
    )
    expect(screen.getByRole("alert")).toBeTruthy()
    // The store cards still rendered. "Hollywood" also appears in the rail's
    // store popover, which is always in the DOM, so this is scoped.
    expect(within(screen.getByText("Per-store ledger").closest(".sec")!).getByText("Hollywood"))
      .toBeTruthy()
  })

  it("renders a pre-open store's empty state with its reason", () => {
    render(
      <CounterOverviewClient {...base} sections={{ ...sections, stores: empty("pre_open") }} />,
    )
    expect(screen.getAllByText(/not trading yet/i).length).toBeGreaterThan(0)
  })

  it("never inspects a section's status itself — the lint proves that, this asserts the result", () => {
    // All six states render through Section. If a page ever branched on status
    // it would diverge from the others; this catches the symptom.
    for (const s of [
      ready([{ label: "Received", value: "0 · $0" }]),
      failed("x", "y"),
      notComputed("z"),
      empty("no_match" as const),
    ]) {
      const { unmount } = render(
        <CounterOverviewClient {...base} sections={{ ...sections, invoices: s }} />,
      )
      expect(screen.getByRole("heading", { level: 2, name: "Monday's numbers" })).toBeTruthy()
      unmount()
    }
  })
})
