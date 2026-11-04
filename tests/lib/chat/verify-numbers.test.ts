/*
 * The answer check: an amount the answer prints has to be one its lookups
 * returned, or plainly worked out from them. These pin both halves — what it
 * must accept (rounding, fractions shown as percents, cents, column totals,
 * week-over-week changes) and what it must flag (a number in no row at all).
 */
import { describe, it, expect } from "vitest"
import { checkAnswerNumbers, claimsIn, uncheckedLine } from "@/lib/chat/verify-numbers"
import type { FiledReturn, ReturnPart } from "@/lib/chat/return"

const tool = (toolName: string, output: unknown): ReturnPart => ({
  type: `tool-${toolName}`,
  toolName,
  state: "output-available",
  output,
})

const filed = (values: string[], verdict = "Sales were up."): FiledReturn => ({
  verdict,
  department: "Sales",
  scope: "",
  figures: values.map((value, i) => ({ value, label: `f${i}` })),
  followUps: [],
  show: [],
})

const sales = tool("getDailySales", {
  rows: [
    { date: "2026-10-27", netSales: 4120.4, orders: 210 },
    { date: "2026-10-28", netSales: 3879.6, orders: 198 },
  ],
  laborPct: 0.2284,
  lastWeek: { netSales: 7000, thisWeek: 8000 },
})

describe("claimsIn", () => {
  it("reads dollars, k/M suffixes and percents, and skips 0 and 100%", () => {
    const c = claimsIn("Net $48,912 (up 12.5%), about $48.9k, $1.2M; 0% and 100% say nothing.")
    expect(c.map((x) => [x.text, x.value])).toEqual([
      ["$48,912", 48912],
      ["12.5%", 12.5],
      ["$48.9k", 48900],
      ["$1.2M", 1200000],
    ])
  })
})

describe("checkAnswerNumbers", () => {
  it("accepts returned numbers, rounding, fraction-as-percent, column totals and changes", () => {
    const check = checkAnswerNumbers(
      [sales],
      filed(["$4,120", "22.8%", "$8,000"], "Two days came to $8,000, up $1,000 or 14.3% on last week."),
      "Monday did $4,120.40 on 210 orders.",
    )
    expect(check.unchecked).toEqual([])
    expect(check.figures).toEqual([false, false, false])
  })

  it("flags an amount that is in no row and marks the figure that carried it", () => {
    const check = checkAnswerNumbers([sales], filed(["$4,120", "$9,250"]), "Food cost was 31%.")
    expect(check.figures).toEqual([false, true])
    expect(check.unchecked).toEqual(["$9,250", "31%"])
  })

  it("reads cents shown as dollars", () => {
    const shop = tool("getShopOrders", { sales: { paidCents: 123450 } })
    expect(checkAnswerNumbers([shop], filed(["$1,234.50"]), "").unchecked).toEqual([])
  })

  it("in a turn with no data tool, checks only the filed figures, not the paragraph", () => {
    const only = tool("fileReturn", { verdict: "x", department: "No data" })
    expect(checkAnswerNumbers([only], null, "Maybe $40?").unchecked).toEqual([])
    const out = checkAnswerNumbers([only], filed(["$5"]), "Maybe $40?")
    expect(out.unchecked).toEqual(["$5"])
    expect(out.figures).toEqual([true])
  })

  it("does not pair numbers that never sat together", () => {
    // 50 / 20 = 250%, but the two live in unrelated rows under different keys.
    const parts = [tool("a", { x: { cost: 50 } }), tool("b", { y: { orders: 20 } })]
    expect(checkAnswerNumbers(parts, null, "Up 250%.").unchecked).toEqual(["250%"])
  })
})

describe("uncheckedLine", () => {
  it("says nothing when everything matched, and names what did not", () => {
    expect(uncheckedLine([])).toBeNull()
    expect(uncheckedLine(["$9,250"])).toMatch(/^Not checked: \$9,250 doesn't match/)
    expect(uncheckedLine(["$1", "2%"])).toMatch(/don't match/)
  })
})

describe("review fixes", () => {
  it("reads million/thousand and drops a trailing comma", () => {
    expect(claimsIn("about $1.2 million, $3 thousand, $5,000, and $.50").map((c) => [c.text, c.value])).toEqual([
      ["$1.2 million", 1200000],
      ["$3 thousand", 3000],
      ["$5,000", 5000],
      ["$.50", 0.5],
    ])
  })

  it("lets a round figure stand only for a close number", () => {
    const parts = [tool("x", { rows: [{ total: 1600 }] })]
    expect(checkAnswerNumbers(parts, null, "About $2,000.").unchecked).toEqual(["$2,000"])
    const close = [tool("x", { rows: [{ total: 1994 }] })]
    expect(checkAnswerNumbers(close, null, "About $2,000.").unchecked).toEqual([])
  })

  it("accepts a daily average and two rows combined", () => {
    const parts = [tool("x", { rows: [{ net: 400 }, { net: 424 }, { net: 412 }] })]
    expect(checkAnswerNumbers(parts, null, "$412 a day; the first two came to $824.").unchecked).toEqual([])
  })

  it("does not read dates or clock times in strings as amounts", () => {
    const parts = [tool("x", { when: "2026-11-03 10:30" })]
    expect(checkAnswerNumbers(parts, null, "$2,026 and 30%").unchecked).toEqual(["$2,026", "30%"])
  })
})
