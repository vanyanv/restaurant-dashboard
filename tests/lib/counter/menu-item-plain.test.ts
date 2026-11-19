import { describe, expect, it } from "vitest"
import { buildItemPlain, type ItemPlainInput } from "@/lib/counter/menu-item-plain"

const input = (over: Partial<ItemPlainInput> = {}): ItemPlainInput => ({
  name: "Signature Slider",
  qty: 1302,
  plateCost: 2.37,
  dealRunning: true,
  mapped: true,
  unmappedModifiers: 0,
  channels: [
    // $7.99 a plate, no deal, no commission: keeps 7.99 − 2.37 = 5.62.
    { channel: "In-house", tint: "var(--ch-house)", qty: 600, revenue: 600 * 7.99, discount: 0, commission: 0 },
    // BOGO halves it, then 21% of what was collected: 7.99/2 − 0.84 − 2.37 ≈ 0.78 (float).
    { channel: "Uber Eats", tint: "var(--ch-uber)", qty: 400, revenue: 400 * 7.99, discount: 200 * 7.99, commission: 400 * 0.84 },
    { channel: "Grubhub", tint: "var(--ch-gh)", qty: 20, revenue: 20 * 7.99, discount: 0, commission: null },
  ],
  recipeHref: "/dashboard/recipes/r1",
  ...over,
})

describe("buildItemPlain", () => {
  it("says what a plate keeps and where a deal and the commission eat it", () => {
    const p = buildItemPlain(input())
    expect(p.sentence).toBe(
      "Sold 1,302. Each one keeps $3.69 after food, deals and app commission. It keeps $5.62 on In-house but only $0.78 on Uber Eats, because of the deal and the commission.",
    )
    expect(p.bars.map((b) => [b.channel, b.value])).toEqual([
      ["In-house", "$5.62"],
      ["Uber Eats", "$0.78"],
      ["Grubhub", "no rate on file"],
    ])
    expect(p.big.missing).toBe("1 channel not counted")
  })

  it("reads not costed, never $0, when no recipe costs it", () => {
    const p = buildItemPlain(input({ plateCost: null, mapped: false, recipeHref: null }))
    expect(p.big.value).toBeNull()
    expect(p.bars.every((b) => b.value === "not costed" && b.share === 0)).toBe(true)
    expect(p.statuses[0]).toEqual({ tone: "bad", text: "No recipe linked" })
    expect(p.recipe).toBeNull()
  })
})
