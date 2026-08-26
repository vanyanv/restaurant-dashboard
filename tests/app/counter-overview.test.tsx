// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"

// CounterOverviewClient calls useRouter() (for the controls' router.push)
// unconditionally on every render. Outside a real Next.js App Router tree —
// which is exactly what a plain RTL render is — that throws an invariant.
// None of these tests click a control, so a no-op push is enough.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}))

import { CounterOverviewClient } from "@/app/dashboard/counter-overview-client"
import { ready, failed, notComputed, empty } from "@/lib/counter/section-data"
import type { OverviewSections } from "@/lib/counter/adapters/overview"

const base = {
  pathname: "/dashboard",
  // A plain query string, not a URLSearchParams instance — see the
  // component's own doc comment on why (RSC serialisation strips a class
  // instance's prototype; a real browser catches this, a unit test that
  // constructs the component directly does not).
  params: "",
  stores: [{ id: "hollywood", name: "Hollywood", stage: "trading" as const }],
  user: { name: "Chris Karimian", role: "Owner" },
  today: new Date(2026, 7, 25),
}

// The brief's original fixture put netSales, orders, avgTicket and splh all
// under one `lead` section with one status. A single SectionData can only
// carry one status and the two figures come from different rollups, so
// `sales` and `splh` replace `lead` as two sections — see the adapter's own
// doc comment on OverviewSections.
//
// Task 2 grew the adapter from four sections to twelve. This island composes
// the ones it already had; the rest are present so the fixture types, and are
// composed by Task 3.
const sections: OverviewSections = {
  sales: ready({ netSales: 7468, comparison: "▲ 4.1% vs the prior period" }),
  splh: ready({ value: 71.4, floor: null, series: [68, 70, 71.4] }),
  strip: ready([{ label: "Orders", value: "1,024" }]),
  verdict: notComputed("a published target for any headline figure"),
  moving: ready([{ label: "Range", value: "1 days", note: "1 daily buckets · no comparison" }]),
  needsYou: notComputed("alerts and decisions queue"),
  salesChart: ready({ labels: ["Mon"], series: [{ name: "Net sales", color: "var(--ink)", data: [7468] }] }),
  splhChart: ready({ labels: ["Mon"], series: [{ name: "SPLH", color: "var(--ink)", data: [71.4] }] }),
  stores: ready([
    {
      kind: "trading",
      id: "hollywood",
      name: "Hollywood",
      netSales: 7468,
      series: [7468],
      comparison: "no comparison set",
      orders: 291,
      ticket: 25.66,
      salesPerHour: 71.4,
    },
  ]),
  ledger: ready([{ storeId: "hollywood", store: "Hollywood", net: 7468, cogsPct: 28.4, deltaVsTargetPp: -1.2 }]),
  channels: ready([{ channel: "house", net: 4000, orders: 160, commission: 0, ticket: 25 }]),
  invoices: ready([
    { label: "Received", value: "34 · $63,203" },
    { label: "In review", value: "6 · $2,140", tone: "warn" },
    { label: "Posted to COGS", value: "28 · $61,063", total: true },
  ]),
  modelCall: notComputed("the model's call for this day"),
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

  it("puts the dispatch line at PAGE level, above every section — never inside one", () => {
    // Task 4 measured our head figure sitting inside the first `.sec` while the
    // prototype's head block sits above all six, and the fidelity gate reported
    // it as four EXTRA landmarks. The dispatch line is the first element of the
    // screen in `P.overview.desk()` (line 4231), and it has to be here.
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    const main = container.querySelector("main#ct-main") as HTMLElement
    const dispatch = main.querySelector(".dispatch") as HTMLElement
    expect(dispatch.parentElement).toBe(main)
    expect(dispatch.closest(".sec")).toBeNull()
    // .pagehead first, .dispatch second, then the sections.
    const kids = [...main.children].map((c) => c.className.split(" ")[0])
    expect(kids.slice(0, 2)).toEqual(["pagehead", "dispatch"])
    expect(kids.slice(2)).toEqual(new Array(6).fill("sec"))
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
    expect(screen.getByText(/Glendale is not trading yet/)).toBeTruthy()
  })

  it("does not offer the queue link the prototype does — /dashboard/needs-you is not served yet", () => {
    const { container } = render(<CounterOverviewClient {...base} sections={sections} />)
    expect(container.querySelector(".dispatch .go")).toBeNull()
  })

  it("shows net sales, the first of the two numbers an owner checks", () => {
    // Note 30: net sales says whether the day happened; sales per labour hour
    // says whether it was worth having. SPLH itself is owed (R1) — asserted
    // separately below — so it cannot appear as a figure here. "$7,468"
    // legitimately appears twice: once as the headline figure, once as
    // Hollywood's row in the per-store ledger below it (the fixture's single
    // store IS the whole account here) — both are net sales, honestly.
    render(<CounterOverviewClient {...base} sections={sections} />)
    expect(screen.getAllByText("$7,468").length).toBeGreaterThan(0)
  })

  it("names owed sections instead of showing a zero", () => {
    render(<CounterOverviewClient {...base} sections={sections} />)
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
    // The ledger still rendered. Scoped to the table: "Hollywood" also appears
    // in the rail's store popover, which is always in the DOM now.
    expect(within(screen.getByRole("table")).getByText("Hollywood")).toBeTruthy()
  })

  it("renders a pre-open store's empty state with its reason", () => {
    render(
      <CounterOverviewClient {...base} sections={{ ...sections, ledger: empty("pre_open") }} />,
    )
    expect(screen.getByText(/not trading yet/i)).toBeTruthy()
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
