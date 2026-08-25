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
// under one `lead` section with one status. R1 (Plan 7) makes that
// impossible: SPLH is unconditionally `not_computed` while net sales stays
// `ready`, and a single SectionData can only carry one status. `sales` and
// `splh` replace `lead` as two sections — see the adapter's own doc comment
// on OverviewSections. "orders" and "avgTicket" are dropped rather than
// invented: note 30 names exactly two figures an owner checks (net sales,
// sales per labour hour), and nothing in the adapter's real data sources
// (getCogsKpis/getCogsStoreOverview) supplies an order count or an average
// ticket — showing them would be exactly the "cell that quietly answers a
// different question" the ruling forbids.
const sections = {
  sales: ready({ netSales: 7468 }),
  splh: notComputed("sales per labour hour scoped to the selected range"),
  ledger: ready([{ storeId: "hollywood", store: "Hollywood", net: 7468, cogsPct: 28.4, deltaVsTargetPp: -1.2 }]),
  invoices: ready({ spend: 63203, count: 34, needsReview: 6, avgInvoice: 1858.9 }),
  needsYou: notComputed("alerts and decisions queue"),
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

  it("names owed sections instead of showing a zero, including SPLH itself", () => {
    render(<CounterOverviewClient {...base} sections={sections} />)
    expect(screen.getByText(/alerts and decisions queue/)).toBeTruthy()
    expect(screen.getByText(/sales per labour hour scoped to the selected range/)).toBeTruthy()
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
      ready({ spend: 0, count: 0, needsReview: 0, avgInvoice: 0 }),
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
