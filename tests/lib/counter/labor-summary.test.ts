import { describe, expect, it } from "vitest"
import { buildLaborSummary, buildLaborWeeks, compareLaborWeeks, LABOR_DAYS_SHOWN } from "@/lib/counter/labor-summary"
import type { LaborDay, LaborTrendWeek, LaborWeek } from "@/lib/counter/labor-week"

function day(key: string, label: string, o: Partial<LaborDay> = {}): LaborDay {
  return {
    key,
    label,
    actualHours: 100,
    scheduledHours: 96,
    cost: 2000,
    missingStoreDays: 0,
    costMissing: false,
    ratedSales: 8000,
    splh: 80,
    laborPct: 25,
    totalSales: 8000,
    compare: null,
    awaitingStoreDays: 0,
    ...o,
  }
}

function week(o: Partial<LaborWeek> = {}): LaborWeek {
  return {
    days: [],
    actualHours: 200,
    scheduledHours: 190,
    cost: 4000,
    missingStoreDays: 0,
    blendedRate: 20,
    splh: 80,
    laborPct: 25,
    overtimeCost: 0,
    compare: null,
    awaitingDays: [],
    awaitingStoreDays: 0,
    provisionalDays: [],
    ...o,
  }
}

function trend(key: string, end: string, o: Partial<LaborTrendWeek> = {}): LaborTrendWeek {
  return { key, end, label: key.slice(5), cost: 15000, hours: 800, sales: 60000, laborPct: 25, splh: 75, missingStoreDays: 0, isPartial: false, ...o }
}

describe("buildLaborSummary", () => {
  it("words each day and marks the range's own share, without grading a day", () => {
    const s = buildLaborSummary({
      days: [day("2026-11-09", "Mon Nov 9", { laborPct: 32, cost: 2050, ratedSales: 6400, totalSales: 6400, actualHours: 112 })],
      week: week({ laborPct: 28 }),
      roles: [],
      storeShares: [],
    })
    expect(s.days[0]).toMatchObject({ dow: "Mon", date: "Nov 9", share: "32.0%", missing: false, detail: "$2,050 on $6,400 · 112 h" })
    expect(s.days[0].fill).toBeGreaterThan(s.dayMark as number)
    expect(s.dayMarkLabel).toBe("28.0%")
    expect(s.dayNote).toContain("No labor target is on file")
  })

  it("says missing for a day that sold with no labor, never 0%", () => {
    const s = buildLaborSummary({
      days: [day("2026-11-10", "Tue Nov 10", { cost: 0, actualHours: 0, costMissing: true, missingStoreDays: 1, ratedSales: 0, laborPct: null, totalSales: 1450 })],
      week: week({ laborPct: null }),
      roles: [],
      storeShares: [],
    })
    expect(s.days[0]).toMatchObject({ share: "missing", fill: 0, missing: true, detail: "sold $1,450 · no labor from Harri" })
    expect(s.dayMark).toBeNull()
  })

  it("keeps the share of the stores that reported when one store is missing", () => {
    const s = buildLaborSummary({
      days: [day("2026-11-10", "Tue Nov 10", { costMissing: true, missingStoreDays: 1, ratedSales: 6000, totalSales: 7500, laborPct: 30, cost: 1800 })],
      week: week(),
      roles: [],
      storeShares: [],
    })
    expect(s.days[0].share).toBe("30.0%")
    expect(s.days[0].detail).toBe("$1,800 on $6,000 · 100 h · 1 store missing")
  })

  it("marks days Harri has not settled and shows only the last days of a long range", () => {
    const days = Array.from({ length: LABOR_DAYS_SHOWN + 3 }, (_, i) => day(`2026-11-${String(i + 1).padStart(2, "0")}`, `D${i + 1}`))
    const s = buildLaborSummary({ days, week: week({ provisionalDays: [`D${LABOR_DAYS_SHOWN + 3}`] }), roles: [], storeShares: [] })
    expect(s.days).toHaveLength(LABOR_DAYS_SHOWN)
    expect(s.days[s.days.length - 1].provisional).toBe(true)
    expect(s.dayNote).toContain(`last ${LABOR_DAYS_SHOWN} days`)
  })

  it("draws store cards only when there is more than one store, and never praises an incomplete one", () => {
    const shares = [
      { storeId: "h", name: "Hollywood", cost: 8330, ratedSales: 31200, laborPct: 26.7 },
      { storeId: "g", name: "Glendale", cost: 1090, ratedSales: 13300, laborPct: 8.2 },
      { storeId: "n", name: "New", cost: 0, ratedSales: 0, laborPct: null },
    ]
    const s = buildLaborSummary({ days: [], week: week(), roles: [], storeShares: shares })
    expect(s.stores.map((c) => c.status.label)).toEqual(["Labor on file", "Labor looks incomplete", "No labor on file"])
    expect(s.stores[1].figures[0]).toEqual({ label: "Share on file", value: "8.2%" })
    expect(s.stores[2].figures[1].value).toBe("missing")
    expect(buildLaborSummary({ days: [], week: week(), roles: [], storeShares: shares.slice(0, 1) }).stores).toEqual([])
  })

  it("ranks roles by cost and names overtime in dollars", () => {
    const s = buildLaborSummary({
      days: [],
      week: week({ overtimeCost: 378 }),
      roles: [
        { position: "Cashier", payType: "HOURLY", hours: 262, cost: 4560, share: 38.2 },
        { position: "Line cook", payType: "HOURLY", hours: 410, cost: 7380, share: 61.8 },
        { position: "Operator", payType: "SALARIED", hours: 0, cost: 0, share: 0 },
      ],
      storeShares: [],
    })
    expect(s.roles.map((r) => r.label)).toEqual(["Line cook", "Cashier"])
    expect(s.roles[0]).toMatchObject({ fill: 100, cost: "$7,380", detail: "410 h · 61.8%" })
    expect(s.rolesNote).toContain("Overtime paid: $378")
  })
})

describe("buildLaborWeeks", () => {
  const weeks = [
    trend("2026-10-26", "2026-11-01", { laborPct: 27.1, cost: 16260, sales: 60000 }),
    trend("2026-11-02", "2026-11-08", { laborPct: 26.9, cost: 14000, sales: 52000 }),
    trend("2026-11-09", "2026-11-15", { laborPct: 28, cost: 15610, sales: 55800, hours: 850, splh: 65.65 }),
    trend("2026-11-16", "2026-11-19", { laborPct: 30, cost: 9000, sales: 30000, isPartial: true }),
  ]

  it("selects the week on screen and opens the comparison on it and the week before", () => {
    const v = buildLaborWeeks(weeks, "2026-11-09", "2026-11-15")
    expect(v.weeks.map((w) => w.selected)).toEqual([false, false, true, false])
    expect(v.compare).toEqual({ a: "2026-11-09", b: "2026-11-02" })
    expect(v.weeks[3]).toMatchObject({ label: "so far", running: true })
    expect(v.weeks[0].salesFill).toBe(100)
    expect(v.weeks[2].laborFill).toBeCloseTo((15610 / 55800) * 100)
  })

  it("falls back to the newest whole week when the range is not one week", () => {
    const v = buildLaborWeeks(weeks, "2026-11-13", "2026-11-19")
    expect(v.weeks.some((w) => w.selected)).toBe(false)
    expect(v.compare).toEqual({ a: "2026-11-09", b: "2026-11-02" })
    expect(v.sentence).toContain("from 26.9% of sales")
  })

  it("draws a week that sold with no labor as missing, not as 0%", () => {
    const v = buildLaborWeeks([trend("2026-11-09", "2026-11-15", { cost: 0, hours: 0, laborPct: 0, splh: null })], "x", "y")
    expect(v.weeks[0]).toMatchObject({ top: "missing", missing: true, laborPct: null, laborFill: 0 })
    expect(v.compare).toBeNull()
    expect(v.sentence).toContain("No whole week")
  })
})

describe("compareLaborWeeks", () => {
  it("sets two weeks side by side, with the share going down as the good direction", () => {
    const v = buildLaborWeeks(
      [
        trend("2026-11-02", "2026-11-08", { laborPct: 26.9, cost: 14000, sales: 52000, hours: 800, splh: 65 }),
        trend("2026-11-09", "2026-11-15", { laborPct: 28, cost: 15610, sales: 55800, hours: 850, splh: 65.65 }),
      ],
      "2026-11-09",
      "2026-11-15",
    )
    const rows = compareLaborWeeks(v.weeks[1], v.weeks[0])
    expect(rows.map((r) => [r.key, r.a, r.b, r.change, r.tone])).toEqual([
      ["sales", "$55,800", "$52,000", "▲ $3,800", "up"],
      ["cost", "$15,610", "$14,000", "▲ $1,610", "flat"],
      ["share", "28.0%", "26.9%", "▲ 1.1 pts", "down"],
      ["hours", "850 h", "800 h", "▲ 50 h", "flat"],
      ["splh", "$65.65", "$65.00", "▲ $0.65", "up"],
    ])
  })

  it("leaves the change blank when one side has no labor", () => {
    const v = buildLaborWeeks(
      [trend("2026-11-02", "2026-11-08", { cost: 0, hours: 0, laborPct: 0, splh: null }), trend("2026-11-09", "2026-11-15")],
      "a",
      "b",
    )
    const rows = compareLaborWeeks(v.weeks[1], v.weeks[0])
    expect(rows.find((r) => r.key === "share")).toMatchObject({ b: "missing", change: "", tone: "flat" })
    expect(rows.find((r) => r.key === "sales")?.change).toBe("flat")
  })
})
