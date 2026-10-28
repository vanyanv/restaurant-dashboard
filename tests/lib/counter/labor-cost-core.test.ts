import { describe, expect, it } from "vitest"
import {
  combineLaborDay,
  daysBetween,
  foldLaborCost,
  hasFixedLabor,
  laborInWindow,
  missingLaborByDay,
  missingStoresByDay,
} from "@/lib/counter/labor-cost-core"

describe("combineLaborDay", () => {
  it("prefers the daily actual when both are present", () => {
    expect(combineLaborDay(1200, 1150)).toEqual({ amount: 1200, source: "daily" })
  })
  it("uses the daily actual when it is the only one", () => {
    expect(combineLaborDay(900, null)).toEqual({ amount: 900, source: "daily" })
    expect(combineLaborDay(900, undefined)).toEqual({ amount: 900, source: "daily" })
  })
  it("uses the positions when only they are present", () => {
    expect(combineLaborDay(null, 1300)).toEqual({ amount: 1300, source: "positions" })
    expect(combineLaborDay(undefined, 1300)).toEqual({ amount: 1300, source: "positions" })
  })
  it("does not believe a daily 0 when positions exist", () => {
    expect(combineLaborDay(0, 1300)).toEqual({ amount: 1300, source: "positions" })
  })
  it("is missing, not 0, when neither table has a reading", () => {
    expect(combineLaborDay(null, null)).toBeNull()
    expect(combineLaborDay(undefined, undefined)).toBeNull()
    // a daily 0 with no positions is a sync placeholder, not a day of no pay
    expect(combineLaborDay(0, null)).toBeNull()
  })
  it("treats a position sum of 0 as missing too (a true zero day is indistinguishable)", () => {
    expect(combineLaborDay(null, 0)).toBeNull()
    expect(combineLaborDay(0, 0)).toBeNull()
  })
})

describe("foldLaborCost", () => {
  const days = daysBetween(new Date("2026-10-19T00:00:00Z"), new Date("2026-10-25T00:00:00Z"))

  it("walks the range inclusively", () => {
    expect(days).toHaveLength(7)
    expect(days[0]).toBe("2026-10-19")
    expect(days[6]).toBe("2026-10-25")
  })

  it("Van Nuys week: 2 daily days, 7 position days totals the position week", () => {
    const daily = [
      { storeId: "vn", day: "2026-10-19", actualCost: 1000 },
      { storeId: "vn", day: "2026-10-20", actualCost: 1829 },
    ]
    // positions carry all 7 days; the two daily days are slightly different
    const positions = days.map((day, i) => ({
      storeId: "vn",
      day,
      totalLabor: i === 0 ? 1000 : i === 1 ? 1800 : 1272,
    }))
    const r = foldLaborCost({ storeIds: ["vn"], days, daily, positions })
    expect(r.stores.vn.missingDays).toEqual([])
    expect(r.stores.vn.byDay["2026-10-19"].source).toBe("daily")
    expect(r.stores.vn.byDay["2026-10-21"].source).toBe("positions")
    expect(r.total).toBe(1000 + 1829 + 1272 * 5)
    expect(r.missingStoreDays).toBe(0)
  })

  it("counts days with neither as missing and leaves them out of the total", () => {
    const r = foldLaborCost({
      storeIds: ["a", "b"],
      days,
      daily: [
        { storeId: "a", day: "2026-10-19", actualCost: 500 },
        { storeId: "b", day: "2026-10-19", actualCost: 0 }, // pre-open placeholder
      ],
      positions: [],
    })
    expect(r.stores.a.missingDays).toHaveLength(6)
    expect(r.stores.b.missingDays).toHaveLength(7)
    expect(r.total).toBe(500)
    expect(r.missingStoreDays).toBe(13)
  })

  it("sums stores", () => {
    const r = foldLaborCost({
      storeIds: ["a", "b"],
      days: ["2026-10-19"],
      daily: [{ storeId: "a", day: "2026-10-19", actualCost: 100 }],
      positions: [{ storeId: "b", day: "2026-10-19", totalLabor: 40 }],
    })
    expect(r.total).toBe(140)
  })

  it("ignores rows outside the requested stores and days", () => {
    const r = foldLaborCost({
      storeIds: ["a"],
      days: ["2026-10-19"],
      daily: [
        { storeId: "z", day: "2026-10-19", actualCost: 999 },
        { storeId: "a", day: "2026-10-30", actualCost: 999 },
      ],
      positions: [],
    })
    expect(r.total).toBe(0)
    expect(r.stores.a.missingDays).toEqual(["2026-10-19"])
  })

  it("laborInWindow slices a store by day", () => {
    const r = foldLaborCost({
      storeIds: ["a"],
      days,
      daily: [
        { storeId: "a", day: "2026-10-19", actualCost: 100 },
        { storeId: "a", day: "2026-10-21", actualCost: 300 },
      ],
      positions: [],
    })
    expect(laborInWindow(r.stores.a, "2026-10-19", "2026-10-20")).toEqual({
      amount: 100,
      coveredDays: 1,
      missingDays: 1,
    })
    expect(laborInWindow(undefined, "2026-10-19", "2026-10-20").coveredDays).toBe(0)
  })
})

describe("hasFixedLabor", () => {
  it("treats null and 0 as not set", () => {
    expect(hasFixedLabor(null)).toBe(false)
    expect(hasFixedLabor(undefined)).toBe(false)
    expect(hasFixedLabor(0)).toBe(false)
    expect(hasFixedLabor(25000)).toBe(true)
  })
})

describe("missingLaborByDay — all-stores gaps", () => {
  it("names the store with no reading even when another store has data", () => {
    const cost = foldLaborCost({
      storeIds: ["a", "b"],
      days: ["2026-10-19"],
      daily: [{ storeId: "a", day: "2026-10-19", actualCost: 500 }],
      positions: [],
    })
    expect(missingStoresByDay(cost)).toEqual({ "2026-10-19": ["b"] })
    const sales = new Map([
      ["a", new Map([["2026-10-19", 3000]])],
      ["b", new Map([["2026-10-19", 2000]])],
    ])
    expect(missingLaborByDay(missingStoresByDay(cost), sales)).toEqual({
      "2026-10-19": { storeDays: 1, sales: 2000 },
    })
  })

  it("does not count a store-day that sold nothing (pre-open)", () => {
    const sales = new Map([["b", new Map([["2026-10-19", 0]])]])
    expect(missingLaborByDay({ "2026-10-19": ["b"] }, sales)).toEqual({})
  })
})
