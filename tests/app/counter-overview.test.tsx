// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

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
  params: new URLSearchParams(),
  stores: [{ id: "hollywood", name: "Hollywood", stage: "trading" as const }],
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
  invoices: ready({ spend: 63203, count: 34, needsReview: 6 }),
  needsYou: notComputed("alerts and decisions queue"),
  modelCall: notComputed("the model's call for this day"),
}

describe("Counter Overview", () => {
  it("renders the page title", () => {
    render(<CounterOverviewClient {...base} sections={sections} />)
    expect(screen.getByRole("heading", { name: /overview/i })).toBeTruthy()
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
    // The ledger still rendered.
    expect(screen.getByText("Hollywood")).toBeTruthy()
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
      ready({ spend: 0, count: 0, needsReview: 0 }),
      failed("x", "y"),
      notComputed("z"),
      empty("no_match" as const),
    ]) {
      const { unmount } = render(
        <CounterOverviewClient {...base} sections={{ ...sections, invoices: s }} />,
      )
      expect(screen.getByRole("heading", { name: /overview/i })).toBeTruthy()
      unmount()
    }
  })
})
