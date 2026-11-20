import { describe, expect, it } from "vitest"
import { buildMenuPlain, type MenuPlainInput } from "@/lib/counter/menu-plain"
import type { ItemEconomics, MenuMargin } from "@/lib/counter/item-economics"

const margin = (marginPct: number | null): MenuMargin => ({
  cost: 0,
  revenue: 0,
  collected: 0,
  discount: 0,
  marginPct,
  foodCostPct: marginPct === null ? null : 100 - marginPct,
  items: 0,
})

/** A costed item: `units` sold, keeping `kept` dollars in all. */
const item = (itemName: string, units: number, kept: number | null, deal = false): ItemEconomics =>
  ({
    itemName,
    category: "Burgers",
    categories: ["Burgers"],
    recipeId: kept === null ? null : `r-${itemName}`,
    recipes: [],
    units,
    revenue: units * 10,
    discountShare: 0,
    discount: 0,
    collected: units * 10,
    dealRunning: deal,
    unitPrice: 10,
    collectedUnitPrice: 10,
    costed: kept === null ? null : { units, revenue: units * 10, collected: units * 10, cost: units * 10 - kept },
    plateCost: null,
    foodCostPct: null,
    marginPct: null,
    marginDollars: kept,
    partialDays: 0,
    override: false,
    missingCost: false,
    unmapped: kept === null,
  }) as ItemEconomics

const input = (over: Partial<MenuPlainInput> = {}): MenuPlainInput => ({
  menu: margin(71.2),
  before: margin(70.1),
  beforeLabel: "Nov 9 – 15",
  items: [
    item("Combo #1", 1000, 9840),
    item("Signature Slider", 1302, 7310),
    item("Fries", 900, 5020),
    item("Loaded Fries", 200, 80, true),
    item("Triple Pack", 3, 1),
    item("Halal Slider", 41, null),
  ],
  itemsSold: 6,
  unmappedItems: 1,
  modifiers: 142,
  unmappedModifiers: 6,
  ...over,
})

describe("buildMenuPlain", () => {
  it("says the kept share and its move, the top earner, the thinnest plate and what is not costed", () => {
    const p = buildMenuPlain(input())
    expect(p.sentence).toBe(
      "The menu kept $71.20 of every $100 after food, up 1.1 points. Combo #1 earned the most. Loaded Fries keeps the least per plate, because of a deal. 1 item sold with no cost behind it, so its food isn't counted.",
    )
    expect(p.big.value).toBe("$71.20")
    expect(p.vs).toEqual({ change: "▲ 1.1 pts", tone: "up", against: "vs Nov 9 – 15" })
    expect(p.earners.map((e) => e.name)).toEqual(["Combo #1", "Signature Slider", "Fries"])
  })

  it("never ranks an uncosted dish, and leaves plates sold too few times off the thinnest list", () => {
    const p = buildMenuPlain(input())
    expect(p.earners.some((e) => e.name === "Halal Slider")).toBe(false)
    expect(p.thinnest.map((t) => t.name)).toEqual(["Loaded Fries", "Fries", "Signature Slider"])
    expect(p.thinnest[0]).toMatchObject({ value: "$0.40", note: "a deal is running on it" })
  })

  it("labels what is missing instead of counting it as $0, with one fix per group", () => {
    const p = buildMenuPlain(input())
    expect(p.statuses).toEqual([
      { tone: "warn", text: "5 of 6 items costed" },
      { tone: "warn", text: "1 sold, not costed" },
      { tone: "warn", text: "6 modifiers not costed" },
    ])
    expect(p.big.missing).toBe("1 not costed")
    expect(p.needs.map((n) => [n.act, n.href])).toEqual([
      ["Link them", "/dashboard/menu/catalog"],
      ["Cost them", "/dashboard/menu/catalog"],
    ])
  })

  it("has no number and no comparison when nothing is costed", () => {
    const p = buildMenuPlain(input({ menu: margin(null), before: null, items: [item("Halal Slider", 41, null)] }))
    expect(p.big.value).toBeNull()
    expect(p.vs).toBeNull()
    expect(p.sentence).toMatch(/^Nothing on the menu is costed/)
  })
})
