import { describe, expect, test } from "vitest"
import {
  SHELF_STATES,
  needsOrderNow,
  orderSoonTitle,
  shelfCoverage,
  shelfState,
  stateCounts,
  toOrderNow,
  type ShelfFlow,
  type ShelfState,
} from "@/lib/counter/shelf-state"

const counted = (qty: number, unsized = false) => ({ qty, unsized })

describe("shelfState: the rule table", () => {
  // [what the line is, input, state]
  const table: Array<[string, Parameters<typeof shelfState>[0], ShelfState]> = [
    ["no line on the last finished count", { counted: null, onHandNow: null, flow: null }, "not_counted"],
    ["no line on the last count, even with a draft reading from an older one", { counted: null, onHandNow: 40, flow: "now" }, "not_counted"],
    ["a box with something in it and no size", { counted: counted(12, true), onHandNow: null, flow: null }, "cant_tell"],
    ["a partial line that also reads zero", { counted: counted(0, true), onHandNow: null, flow: "unknown" }, "cant_tell"],
    ["counted zero, nothing uses it", { counted: counted(0), onHandNow: 0, flow: null }, "out"],
    ["counted zero, with a use rate", { counted: counted(0), onHandNow: 0, flow: "now" }, "out"],
    ["counted zero, sales since push it below zero", { counted: counted(0), onHandNow: -3, flow: "unknown" }, "out"],
    ["counted zero, then a delivery came in", { counted: counted(0), onHandNow: 60, flow: "ok" }, "ok"],
    ["counted zero, a delivery came in, nothing uses it", { counted: counted(0), onHandNow: 24, flow: null }, "in_stock"],
    ["has a use rate, order today", { counted: counted(70), onHandNow: 55, flow: "now" }, "order_now"],
    ["has a use rate, order by a later day", { counted: counted(70), onHandNow: 60, flow: "soon" }, "order_soon"],
    ["has a use rate, enough on hand", { counted: counted(70), onHandNow: 65, flow: "ok" }, "ok"],
    ["has a use rate, on hand reads below zero", { counted: counted(5), onHandNow: -2, flow: "unknown" }, "cant_tell"],
    ["counted, no use rate", { counted: counted(8), onHandNow: 8, flow: null }, "in_stock"],
    ["counted, no use rate, nothing to roll forward from", { counted: counted(8), onHandNow: null, flow: null }, "in_stock"],
  ]

  test.each(table)("%s", (_name, input, state) => {
    expect(shelfState(input)).toBe(state)
  })

  test("a counted line is never left without a state, whatever the draft says", () => {
    const flows: Array<ShelfFlow | null> = ["now", "soon", "ok", "unknown", null]
    for (const flow of flows) {
      for (const qty of [0, 1]) {
        for (const unsized of [true, false]) {
          expect(SHELF_STATES).toContain(shelfState({ counted: counted(qty, unsized), onHandNow: qty, flow }))
        }
      }
    }
  })
})

describe("toOrderNow", () => {
  test("counts out and order-today lines, and nothing else", () => {
    const lines = SHELF_STATES.map((state, i) => ({ ingredientId: `i${i}`, state }))
    expect(toOrderNow(lines)).toBe(2)
    expect(SHELF_STATES.filter(needsOrderNow)).toEqual(["out", "order_now"])
  })

  test("an item counted at two stops is ordered once", () => {
    expect(
      toOrderNow([
        { ingredientId: "beef", state: "order_now" },
        { ingredientId: "beef", state: "order_now" },
        { ingredientId: "fries", state: "out" },
      ]),
    ).toBe(2)
  })

  test("is zero for an empty list", () => {
    expect(toOrderNow([])).toBe(0)
  })
})

describe("stateCounts", () => {
  test("has every state, zero when none", () => {
    const c = stateCounts([{ state: "ok" }, { state: "ok" }, { state: "out" }])
    expect(c).toEqual({ out: 1, order_now: 0, order_soon: 0, ok: 2, in_stock: 0, cant_tell: 0, not_counted: 0 })
  })
})

describe("shelfCoverage", () => {
  test("adds only the valued lines and says how many that is", () => {
    const c = shelfCoverage([
      { state: "ok", dollars: 120 },
      { state: "order_now", dollars: 30.5 },
      { state: "cant_tell", dollars: null },
      { state: "in_stock", dollars: null }, // counted, no price on file
      { state: "not_counted", dollars: null },
    ])
    expect(c).toEqual({ lines: 5, counted: 4, valued: 2, notValued: 2, notCounted: 1, dollars: 150.5 })
  })

  test("a counted zero is a real $0, and is valued", () => {
    const c = shelfCoverage([{ state: "out", dollars: 0 }])
    expect(c.valued).toBe(1)
    expect(c.dollars).toBe(0)
  })

  test("no valued line means no total, not $0", () => {
    expect(shelfCoverage([{ state: "cant_tell", dollars: null }, { state: "not_counted", dollars: null }]).dollars).toBeNull()
    expect(shelfCoverage([]).dollars).toBeNull()
  })

  test("never reads a line that was not counted, even if it carries a value", () => {
    const c = shelfCoverage([{ state: "not_counted", dollars: 99 }])
    expect(c).toMatchObject({ counted: 0, valued: 0, notCounted: 1, dollars: null })
  })
})

describe("orderSoonTitle", () => {
  test("names the day when every row shares it", () => {
    expect(orderSoonTitle(["Order by Thu, Nov 12", "Order by Thu, Nov 12"])).toBe("Order by Thu, Nov 12")
  })
  test("falls back to the plain word when the days differ or are missing", () => {
    expect(orderSoonTitle(["Order by Thu, Nov 12", "Order by Fri, Nov 13"])).toBe("Order soon")
    expect(orderSoonTitle(["Order by Thu, Nov 12", null])).toBe("Order soon")
    expect(orderSoonTitle([])).toBe("Order soon")
  })
})
