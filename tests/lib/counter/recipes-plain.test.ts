import { describe, expect, it, vi } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { plainOf, type RecipeData, type RecipeRow } from "@/lib/counter/adapters/recipes"

const row = (id: string, o: Partial<RecipeRow> = {}): RecipeRow => ({
  id,
  name: id,
  category: "Burgers",
  sellable: true,
  confirmed: true,
  lines: 3,
  usedIn: 0,
  cost: 2.37,
  plate: 2.37,
  bookedCost: 0,
  margin: 70,
  partial: false,
  emptyWalk: false,
  price: 7.99,
  soldQty: 100,
  revenue: 799,
  partialDays: 0,
  ...o,
})
const data = (rows: RecipeRow[]): RecipeData =>
  ({ rows, addedRecently: 0, rangeLabel: "Nov 9 – 15", today: new Date("2026-11-19") }) as RecipeData

describe("recipes made plain", () => {
  it("says how much rests on unconfirmed and $0 recipes, and points at the biggest", () => {
    const p = plainOf(
      data([
        row("Signature Slider", { revenue: 5000 }),
        row("Lemonade", { confirmed: false, category: "Drinks", revenue: 3200, cost: 0.41, plate: 0.41 }),
        row("Mystery Shake", { confirmed: false, emptyWalk: true, cost: 0, plate: null, revenue: 0 }),
        row("House sauce", { sellable: false, usedIn: 4 }),
      ]),
    )
    expect(p.sentence).toBe(
      "4 recipes. 2 are confirmed. 2 sold aren't confirmed yet but are costing real plates, $3,200 of sales over Nov 9 – 15. 1 recipe costs $0 because no line on it has a price.",
    )
    expect(p.big).toEqual({ label: "Confirmed", value: "2 of 4", sub: "2 unconfirmed · on $3,200 of sales" })
    expect(p.needs.map((n) => [n.key, n.act, n.href])).toEqual([
      ["zero", "Fix", "/dashboard/recipes/Mystery Shake"],
      ["confirm", "Confirm", "/dashboard/recipes/Lemonade"],
    ])
    expect(p.rows.map((r) => [r.name, r.detail, r.cost, r.tone])).toEqual([
      ["Signature Slider", "Burgers · confirmed", "$2.37", "good"],
      ["Lemonade", "Drinks · not confirmed", "$0.41", "warn"],
      ["Mystery Shake", "Burgers · not confirmed", "$0, no price", "bad"],
    ])
    expect(p.components).toBe(1)
  })

  it("with every recipe confirmed, asks for nothing", () => {
    const p = plainOf(data([row("Slider")]))
    expect(p.sentence).toBe("1 recipe. All are confirmed.")
    expect(p.needs).toEqual([])
    expect(p.big.sub).toBe("every recipe is confirmed")
  })
})
