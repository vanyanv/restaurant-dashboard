import { describe, expect, test } from "vitest"
import { demandOver, draftLine, parseCoverDays } from "@/lib/counter/draft-orders"

const asOf = new Date("2026-11-11T20:00:00Z")

describe("demandOver", () => {
  test("adds whole days, a part day, then the tail rate", () => {
    expect(demandOver([10, 20, 30], 5, 2)).toBe(30)
    expect(demandOver([10, 20, 30], 5, 2.5)).toBe(45)
    expect(demandOver([10, 20, 30], 5, 5)).toBe(70)
    expect(demandOver([], 4, 3.5)).toBe(14)
    expect(demandOver([10], 5, 0)).toBe(0)
  })
})

describe("draftLine", () => {
  // Fries, worked example: 30 lb a case, 40 lb a day, 92 bags × 5 lb = 460 lb on hand.
  test("orders whole cases to cover lead + cover + buffer, less on hand", () => {
    const l = draftLine({ onHand: 460, series: [], tailRate: 40, leadDays: 2, coverDays: 7, recipeUnitsPerCase: 30, asOf })
    expect(l.safetyDays).toBe(1) // max(1, 0.5 × 2)
    expect(l.windowDays).toBe(10)
    expect(l.need).toBe(400)
    expect(l.short).toBe(-60)
    expect(l.cases).toBeNull()
    expect(l.orderQty).toBe(0)
  })

  test("rounds a short amount up to the next case", () => {
    // need 40 × (4 + 7 + 2) = 520, short 520 − 100 = 420 → 14 cases exactly
    const exact = draftLine({ onHand: 100, series: [], tailRate: 40, leadDays: 4, coverDays: 7, recipeUnitsPerCase: 30, asOf })
    expect(exact.need).toBe(520)
    expect(exact.short).toBe(420)
    expect(exact.cases).toBe(14)
    expect(exact.orderQty).toBe(420)
    // one more lb short → 15 cases
    const over = draftLine({ onHand: 99, series: [], tailRate: 40, leadDays: 4, coverDays: 7, recipeUnitsPerCase: 30, asOf })
    expect(over.cases).toBe(15)
  })

  test("uses the forecast series before the tail", () => {
    const l = draftLine({ onHand: 0, series: [10, 10, 50], tailRate: 20, leadDays: 2, coverDays: 3, recipeUnitsPerCase: null, asOf })
    // window 2 + 3 + 1 = 6 days: 10 + 10 + 50 + 3 × 20 = 130
    expect(l.need).toBe(130)
    expect(l.cases).toBeNull()
    expect(l.orderQty).toBe(130)
  })

  test("with no case size, rounds recipe units up", () => {
    const l = draftLine({ onHand: 0.5, series: [], tailRate: 1.1, leadDays: 2, coverDays: 3, recipeUnitsPerCase: null, asOf })
    expect(l.short).toBeCloseTo(6.1)
    expect(l.orderQty).toBe(7)
  })
})

test("parseCoverDays only takes the offered choices", () => {
  expect(parseCoverDays("3")).toBe(3)
  expect(parseCoverDays("14")).toBe(14)
  expect(parseCoverDays("5")).toBe(7)
  expect(parseCoverDays(undefined)).toBe(7)
})
