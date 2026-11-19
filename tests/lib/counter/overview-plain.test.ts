import { describe, expect, it } from "vitest"
import { trailingWeeks } from "@/lib/counter/date-range"
import { buildOverviewPlain, type OverviewPlainInput } from "@/lib/counter/overview-plain"
import { plainFixture } from "../../app/fixtures/pnl-plain"

const WEEKS = trailingWeeks(new Date("2026-08-25T12:00:00"), 8)

const input = (over: Partial<OverviewPlainInput> = {}): OverviewPlainInput => ({
  pnl: plainFixture(WEEKS),
  storeName: null,
  orders: { hollywood: 1_500, glendale: 400 },
  alerts: {
    rows: [
      ...Array.from({ length: 5 }, () => ({ target: "MENU_ITEM", storeId: "hollywood" })),
      { target: "REVENUE", storeId: "hollywood" },
      { target: "REVENUE", storeId: "hollywood" },
    ],
    open: 7,
  },
  ...over,
})

describe("buildOverviewPlain", () => {
  it("takes every money figure from the P&L's own reading", () => {
    const o = buildOverviewPlain(input())
    const p = plainFixture(WEEKS)
    expect(o.sales).toBe(p.sales)
    expect(o.kept).toBe(p.kept)
    expect(o.keptAtMost).toBe(p.atMost)
    expect(o.weeks).toEqual(p.weeks)
    expect(o.salesVs).toEqual({ amount: 8_493, pct: 8_493 / (84_102 - 8_493), label: "Oct 19 – 25" })
  })

  it("says the period in one sentence, with at most when labor is missing", () => {
    const o = buildOverviewPlain(input())
    expect(o.sentence).toBe(
      "Your two stores sold $84,102, up $8,493 (11.2%) on Oct 19 – 25, and kept at most $23,916 after app fees, food, labor and rent. Some labor is missing, so the true kept figure is lower.",
    )
  })

  it("names the one store that sold less", () => {
    const pnl = plainFixture(WEEKS)
    pnl.stores[1] = { ...pnl.stores[1], salesChange: -500 }
    const o = buildOverviewPlain(input({ pnl }))
    expect(o.sentence).toContain("Glendale was the one store that sold less.")
  })

  it("names a single store and never says a store count", () => {
    const o = buildOverviewPlain(input({ storeName: "Hollywood" }))
    expect(o.sentence.startsWith("Hollywood sold $84,102")).toBe(true)
  })

  it("says plainly when nothing sold", () => {
    const pnl = { ...plainFixture(WEEKS), sales: 0, vsPrior: null }
    const o = buildOverviewPlain(input({ pnl }))
    expect(o.sentence).toBe("No sales came in for this period yet.")
    expect(o.statuses.some((s) => s.text === "Every cost on file")).toBe(false)
  })

  it("never reads labor low when days are missing, and never turns unknown orders into 0", () => {
    const o = buildOverviewPlain(input({ orders: null }))
    const glendale = o.stores.find((s) => s.name === "Glendale")!
    expect(glendale.laborPct).toBeNull()
    expect(glendale.laborMissingDays).toBe(2)
    expect(glendale.salesChangePct).toBeNull()
    expect(o.stores.every((s) => s.orders === null)).toBe(true)
    const hollywood = o.stores.find((s) => s.name === "Hollywood")!
    expect(hollywood.laborPct).toBe(0.23)
    expect(hollywood.salesChangePct).toBeCloseTo(2_100 / (47_977 - 2_100))
  })

  it("says status in words: sales, each store's missing labor, and the P&L's other gaps", () => {
    const o = buildOverviewPlain(input())
    expect(o.statuses).toEqual([
      { tone: "good", text: "Sales up on Oct 19 – 25" },
      { tone: "warn", text: "Glendale labor missing 2 days" },
    ])
  })

  it("folds alerts into a few groups, biggest first, after the P&L's own to-dos", () => {
    const o = buildOverviewPlain(input())
    expect(o.needs.map((n) => n.what)).toEqual([
      "Labor is missing",
      "Fill in store settings",
      "5 menu items sold far above or below normal",
      "2 days with unusual sales",
    ])
    expect(o.needs[2].action).toEqual({ label: "Review items", href: "/dashboard/alerts" })
    expect(o.needs[2].why).toBeNull()
  })

  it("says no store sold less when one was flat, never that every store sold more", () => {
    const pnl = plainFixture(WEEKS)
    pnl.stores[1] = { ...pnl.stores[1], salesChange: 0 }
    expect(buildOverviewPlain(input({ pnl })).sentence).toContain("No store sold less.")
  })

  it("reads an order count it does not have as unknown, and alerts that did not load as a to-do", () => {
    const o = buildOverviewPlain(input({ orders: { hollywood: 1_500 }, alerts: null }))
    expect(o.stores.find((s) => s.name === "Glendale")!.orders).toBeNull()
    expect(o.needs.at(-1)!.what).toBe("Alerts did not load")
  })

  it("says when the alert groups are counted from a partial page", () => {
    const o = buildOverviewPlain(input({ alerts: { rows: [{ target: "PRICE", storeId: "glendale" }], open: 140 } }))
    const g = o.needs.find((n) => n.key === "alerts-PRICE")!
    expect(g.what).toBe("1 price change")
    expect(g.why).toBe("Counted from the 1 most serious of 140 open alerts.")
  })

  it("says a change against a tiny earlier period in dollars only, never as a percent", () => {
    const pnl = { ...plainFixture(WEEKS), sales: 9_000, vsPrior: { label: "the week before", kept: 0, pts: null, sales: 8_700 } }
    pnl.stores = [{ ...pnl.stores[0], sales: 9_000, salesChange: 8_700 }]
    const o = buildOverviewPlain(input({ pnl }))
    expect(o.salesVs).toEqual({ amount: 8_700, pct: null, label: "the week before" })
    expect(o.sentence).toContain("up $8,700 on the week before")
    expect(o.stores[0]).toMatchObject({ salesChange: 8_700, salesChangePct: null })
  })

  it("carries the completeness line, and never says every cost is on file when part is estimated", () => {
    const pnl = {
      ...plainFixture(WEEKS),
      atMost: null,
      keptNote: "estimated · 3 days of labor estimated from your labor budget",
      statuses: [{ tone: "warn" as const, text: "Labor: 3 days estimated from your labor budget" }],
      todos: [],
    }
    pnl.stores = pnl.stores.map((s) => ({ ...s, laborMissingDays: 0 }))
    pnl.gaps = { ...pnl.gaps, laborMissingDays: 0, laborEstimatedDays: 3 }
    const o = buildOverviewPlain(input({ pnl }))
    expect(o.keptNote).toBe(pnl.keptNote)
    expect(o.sentence).toContain("kept an estimated $23,916")
    expect(o.sentence).toContain("Part of the kept figure is estimated.")
    expect(o.statuses).toContainEqual({ tone: "warn", text: "Labor: 3 days estimated from your labor budget" })
    expect(o.statuses.some((s) => s.text === "Every cost on file")).toBe(false)
  })
})
