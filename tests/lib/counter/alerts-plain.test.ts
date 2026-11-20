import { describe, expect, it } from "vitest"
import { buildAlertsPlain, SERIOUS_SHOWN, type AlertsPlainInput } from "@/lib/counter/alerts-plain"

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
    expect(p.sentence).toContain("5 look serious; the 1 loaded so far comes from one problem, listed first.")
    expect(p.seriousPartial).toBe(true)
    expect(buildAlertsPlain(alerts()).seriousPartial).toBe(false)
  })


  it("says when the groups are counted from a partial page", () => {
    const p = buildAlertsPlain(alerts({ counts: { open: 144, critical: 1 } }))
    expect(p.groups[0].why).toBe("Counted from the 8 most serious of 144 open alerts.")
  })

  it("puts missed punches first as a Time records group, without counting them as alerts", () => {
    const timeRecords = { missedIn: 13, missedOut: 3, stores: ["Hollywood"], from: "2026-11-13", to: "2026-11-19" }
    const p = buildAlertsPlain(alerts({ timeRecords }))
    expect(p.groups[0]).toMatchObject({
      key: "time-records",
      what: "Time records need fixing: 13 missed clock-ins, 3 missed clock-outs",
      action: { href: "/dashboard/labor" },
    })
    expect(p.open).toBe(8)
    expect(p.sentence).toContain("Most of the rest are 6 menu items")
    expect(p.statuses[0]).toEqual({ tone: "warn", text: "Time records need fixing: 13 missed clock-ins, 3 missed clock-outs" })

    const none = buildAlertsPlain({ openRows: [], serious: [], counts: { open: 0, critical: 0 }, closed: 0, timeRecords })
    expect(none.sentence).toBe("No alerts are open. Time records need fixing: 13 missed clock-ins, 3 missed clock-outs.")
  })

  it("says plainly when nothing is open", () => {
    const p = buildAlertsPlain({ openRows: [], serious: [], counts: { open: 0, critical: 0 }, closed: 0 })
    expect(p.sentence).toBe("Nothing is open. Every alert has been dealt with.")
    expect(p.statuses).toEqual([{ tone: "good", text: "Nothing open" }])
    expect(p.groups).toEqual([])
  })
})
