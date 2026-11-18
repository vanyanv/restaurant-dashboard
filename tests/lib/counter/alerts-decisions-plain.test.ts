import { describe, expect, it } from "vitest"
import { buildAlertsPlain, SERIOUS_SHOWN, type AlertsPlainInput } from "@/lib/counter/alerts-plain"
import { buildDecisionsPlain, type DecisionsPlainInput } from "@/lib/counter/decisions-plain"

const alerts = (over: Partial<AlertsPlainInput> = {}): AlertsPlainInput => ({
  openRows: [
    { target: "INGREDIENT", severity: "CRITICAL" },
    ...Array.from({ length: 6 }, () => ({ target: "MENU_ITEM", severity: "WATCH" })),
    { target: "REVENUE", severity: "INFO" },
  ],
  serious: [{ id: "a1", title: "Ground beef is up 18%", body: "$4.12 to $4.86 per lb", run: null }],
  counts: { open: 8, critical: 1 },
  closed: 3,
  ...over,
})

describe("buildAlertsPlain", () => {
  it("says how many are open, that the serious one is first, and what most of the rest are", () => {
    const p = buildAlertsPlain(alerts())
    expect(p.sentence).toBe(
      "8 alerts are open. One looks serious and is listed first. Most of the rest are 6 menu items sold far above or below normal.",
    )
    expect(p.statuses).toEqual([
      { tone: "bad", text: "1 serious" },
      { tone: "warn", text: "7 to glance at" },
      { tone: "good", text: "3 closed recently" },
    ])
  })

  it("lists the serious ones with the row the list opens, and groups only the rest", () => {
    const p = buildAlertsPlain(alerts())
    expect(p.serious).toEqual([
      { key: "a1", id: "a1", what: "Ground beef is up 18%", why: "$4.12 to $4.86 per lb", href: "/dashboard/alerts?alert=a1" },
    ])
    expect(p.groups.map((g) => [g.what, g.action.href])).toEqual([
      ["6 menu items sold far above or below normal", "/dashboard/menu/items"],
      ["1 day with unusual sales", "/dashboard/analytics"],
    ])
  })

  it("shows the first few serious ones and counts the others", () => {
    const serious = Array.from({ length: SERIOUS_SHOWN + 2 }, (_, i) => ({ id: `s${i}`, title: `T${i}`, body: null, run: "3 times since Nov 1" }))
    const p = buildAlertsPlain(alerts({ serious, counts: { open: 20, critical: 7 } }))
    expect(p.serious).toHaveLength(SERIOUS_SHOWN)
    expect(p.seriousMore).toBe(2)
    expect(p.serious[0].why).toBe("3 times since Nov 1")
  })

  it("says serious alerts and the problems behind them apart, and says when not all loaded", () => {
    const p = buildAlertsPlain(alerts({ counts: { open: 12, critical: 5 } }))
    expect(p.sentence).toContain("5 look serious; they come from one problem, listed first.")
    expect(p.seriousPartial).toBe(true)
    expect(buildAlertsPlain(alerts()).seriousPartial).toBe(false)
  })

  it("counts what runs out with the shelf's own number, lists only rows past the line, and words hours", () => {
    const rows = [
      { key: "a", name: "Fries", store: null, outLabel: "Thu open", qty: "", href: "/x", tagTone: "bad" },
      { key: "b", name: "Rolls", store: null, outLabel: "Sat close", qty: "", href: "/y", tagTone: "warn" },
    ]
    const p = buildDecisionsPlain(decisions({ runOut: { hot: 1, rows }, laborGapHours: -1, vsPrior: 0.0001 }))
    expect(p.runOut.map((r) => r.name)).toEqual(["Fries"])
    expect(p.statuses.map((s) => s.text)).toEqual(expect.arrayContaining(["1 running out before delivery", "Schedule short 1 hour"]))
    expect(p.sentence.startsWith("This week should sell about $112,400, level with last week.")).toBe(true)
  })

  it("says when the groups are counted from a partial page", () => {
    const p = buildAlertsPlain(alerts({ counts: { open: 144, critical: 1 } }))
    expect(p.groups[0].why).toBe("Counted from the 8 most serious of 144 open alerts.")
  })

  it("says plainly when nothing is open", () => {
    const p = buildAlertsPlain({ openRows: [], serious: [], counts: { open: 0, critical: 0 }, closed: 0 })
    expect(p.sentence).toBe("Nothing is open. Every alert has been dealt with.")
    expect(p.statuses).toEqual([{ tone: "good", text: "Nothing open" }])
    expect(p.groups).toEqual([])
  })
})

const decisions = (over: Partial<DecisionsPlainInput> = {}): DecisionsPlainInput => ({
  total: 112_400,
  vsPrior: 0.061,
  vsText: "▲ 6.1% on last week",
  accuracy: { inside: 24, sample: 30 },
  laborGapHours: -11,
  laborShort: true,
  runOutNote: null,
  runOut: {
    hot: 1,
    rows: [
      { key: "f", name: "Fries", store: "Van Nuys", outLabel: "Thu 11/20 lunch", qty: "2 cases", href: "/dashboard/count/item/f", tagTone: "bad" },
      { key: "r", name: "Rolls", store: "Hollywood", outLabel: "Mon 11/24 close", qty: "", href: "/dashboard/count/item/r", tagTone: "good" },
    ],
  },
  calls: [
    { key: "c1", title: "Add a closer on Saturday", why: "Saturday is short 11 hours. Last three Saturdays ran over.", lead: "$420", unit: "/wk", note: "decays daily", act: "Open labor", href: "/dashboard/labor" },
  ],
  ...over,
})

describe("buildDecisionsPlain", () => {
  it("says the week, the first run-out and the first call in one sentence", () => {
    const p = buildDecisionsPlain(decisions())
    expect(p.sentence).toBe(
      "This week should sell about $112,400, up 6.1% on last week. Fries at Van Nuys runs out Thu 11/20 lunch unless you bring in 2 cases. The first call: add a closer on Saturday.",
    )
    expect(p.vsTone).toBe("up")
  })

  it("lists only what runs out before delivery, and each call with its own button", () => {
    const p = buildDecisionsPlain(decisions())
    expect(p.runOut.map((r) => r.name)).toEqual(["Fries"])
    expect(p.calls[0]).toEqual({
      key: "c1",
      title: "Add a closer on Saturday",
      why: "Saturday is short 11 hours.",
      worth: "$420/wk",
      when: "decays daily",
      action: { label: "Open labor", href: "/dashboard/labor" },
    })
  })

  it("says status in words: run-outs, a short schedule, and how the forecast has landed", () => {
    expect(buildDecisionsPlain(decisions()).statuses).toEqual([
      { tone: "bad", text: "1 running out before delivery" },
      { tone: "warn", text: "Schedule short 11 hours" },
      { tone: "good", text: "Forecast in range on 24 of 30 days" },
    ])
  })

  it("never invents a forecast, and says when run-outs cannot be known", () => {
    const p = buildDecisionsPlain(
      decisions({ total: null, vsPrior: null, vsText: "no comparison set", runOut: null, runOutNote: "Pick one store to see what runs out", calls: [], accuracy: { inside: null, sample: 0 } }),
    )
    expect(p.sentence).toBe("No forecast has been made for this week yet. No decision needs you this week.")
    expect(p.total).toBeNull()
    expect(p.vsTone).toBe("flat")
    expect(p.statuses.map((s) => s.text)).toContain("Pick one store to see what runs out")
    expect(p.statuses.map((s) => s.text)).toContain("Forecast accuracy not measured yet")
  })
})
