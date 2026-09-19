// The days a store actually traded.
//
// Two analyses built their series by walking the calendar and filling every
// missing day with zero, which is a claim that the store was open and sold
// nothing. See the module docblock.

import { describe, it, expect } from "vitest"
import {
  tradingDayKey,
  tradedDaysByStore,
  tradingDaysIn,
  trailingTradingDayQtys,
  tradingRate,
} from "@/lib/trading-days"

const read = (r: { storeId: string; date: Date; qty: number }) => ({
  storeId: r.storeId,
  date: r.date,
  soldSomething: r.qty > 0,
})

const at = (key: string) => new Date(`${key}T00:00:00Z`)

describe("tradingDayKey", () => {
  it("is the business date, not a local rendering of it", () => {
    expect(tradingDayKey(at("2026-04-15"))).toBe("2026-04-15")
  })
})

describe("tradedDaysByStore", () => {
  it("keeps one set per store", () => {
    const out = tradedDaysByStore(
      [
        { storeId: "s1", date: at("2026-04-15"), qty: 3 },
        { storeId: "s1", date: at("2026-04-16"), qty: 1 },
        { storeId: "s2", date: at("2026-04-15"), qty: 2 },
      ],
      read,
    )
    expect([...out.get("s1")!].sort()).toEqual(["2026-04-15", "2026-04-16"])
    expect([...out.get("s2")!]).toEqual(["2026-04-15"])
  })

  it("a published row that sold nothing is not evidence the doors were open", () => {
    const out = tradedDaysByStore(
      [{ storeId: "s1", date: at("2026-04-15"), qty: 0 }],
      read,
    )
    expect(out.get("s1")).toBeUndefined()
  })

  it("counts a day once however many items sold on it", () => {
    const out = tradedDaysByStore(
      [
        { storeId: "s1", date: at("2026-04-15"), qty: 3 },
        { storeId: "s1", date: at("2026-04-15"), qty: 9 },
      ],
      read,
    )
    expect(out.get("s1")!.size).toBe(1)
  })
})

describe("tradingDaysIn", () => {
  const days = new Set(["2026-04-17", "2026-04-15", "2026-04-16"])

  it("returns them oldest first", () => {
    expect(tradingDaysIn(days)).toEqual(["2026-04-15", "2026-04-16", "2026-04-17"])
  })

  it("windows on both ends, inclusive", () => {
    expect(tradingDaysIn(days, { sinceKey: "2026-04-16" })).toEqual([
      "2026-04-16",
      "2026-04-17",
    ])
    expect(tradingDaysIn(days, { untilKey: "2026-04-16" })).toEqual([
      "2026-04-15",
      "2026-04-16",
    ])
  })
})

describe("trailingTradingDayQtys", () => {
  const tradedDayKeys = new Set(
    Array.from({ length: 10 }, (_, i) => `2026-04-${String(11 + i).padStart(2, "0")}`),
  )

  it("puts a zero on a trading day the item did not sell", () => {
    // The item sold on three of the last seven days the store was open. The
    // old code took the last seven ROWS, which is those three days plus four
    // older ones, and called the result a seven-day rate.
    const qtyByDateKey = new Map([
      ["2026-04-14", 5],
      ["2026-04-18", 5],
      ["2026-04-20", 5],
    ])
    expect(
      trailingTradingDayQtys({
        tradedDayKeys,
        qtyByDateKey,
        sinceKey: "2026-04-11",
        untilKey: "2026-04-20",
        days: 7,
      }),
      // 04-14 through 04-20: the three selling days in place, four zeros
      // between them. The old code returned [5, 5, 5] and called it a week.
    ).toEqual([5, 0, 0, 0, 5, 0, 5])
  })

  it("does not reach back before the item's first sale", () => {
    expect(
      trailingTradingDayQtys({
        tradedDayKeys,
        qtyByDateKey: new Map([["2026-04-19", 4]]),
        sinceKey: "2026-04-18",
        untilKey: "2026-04-20",
        days: 7,
      }),
    ).toEqual([0, 4, 0])
  })

  it("skips a day the store did not trade rather than zeroing it", () => {
    const withGap = new Set(["2026-04-11", "2026-04-12", "2026-04-15"])
    expect(
      trailingTradingDayQtys({
        tradedDayKeys: withGap,
        qtyByDateKey: new Map([["2026-04-11", 2], ["2026-04-15", 2]]),
        sinceKey: "2026-04-11",
        untilKey: "2026-04-15",
        days: 7,
      }),
      // Three entries, not five: the 13th and 14th never happened.
    ).toEqual([2, 0, 2])
  })
})

describe("tradingRate", () => {
  it("is 1 for a store open every day of the span", () => {
    expect(tradingRate(["2026-04-11", "2026-04-12", "2026-04-13"])).toBe(1)
  })

  it("is the open share for a store dark one day a week", () => {
    const days: string[] = []
    for (let i = 0; i < 28; i += 1) {
      const d = new Date("2026-04-11T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      if (d.getUTCDay() === 1) continue
      days.push(tradingDayKey(d))
    }
    // 24 of 28 calendar days. Projecting 90 calendar days as 90 selling days
    // would sell four Mondays the store is shut for.
    expect(tradingRate(days)).toBeCloseTo(24 / 28, 10)
  })

  it("is 1, not 0, when nothing is known", () => {
    expect(tradingRate([])).toBe(1)
  })

  it("never exceeds 1", () => {
    expect(tradingRate(["2026-04-11", "2026-04-11"])).toBe(1)
  })
})
