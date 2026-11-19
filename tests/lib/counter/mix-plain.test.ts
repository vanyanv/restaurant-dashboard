import { describe, expect, it, vi } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { plainOf, type MixData, type Unit, type Window } from "@/lib/counter/adapters/product-mix"
import type { MenuMargin } from "@/lib/counter/item-economics"

// cost and collected are per costed unit here, so a unit's totals are easy to read.
const unit = (qty: number, cost: number, price: number): Unit => ({
  qty,
  costedQty: qty,
  costTotal: cost * qty,
  collectedTotal: price * qty,
  inBlend: true,
})
const win = (orders: number, units: Record<string, Unit>): Window => ({
  units: new Map(Object.entries(units)),
  totalQty: Object.values(units).reduce((s, u) => s + u.qty, 0),
  orders,
  menu: {} as MenuMargin,
})

describe("product mix made plain", () => {
  it("says what sold, who moved and why the kept share moved, with a bridge that adds up", () => {
    const prior = win(100, { Slider: unit(100, 3, 10), Fries: unit(100, 1, 5) })
    const now = win(100, { Slider: unit(150, 3, 10), Fries: unit(50, 1, 5) })
    const p = plainOf({ now, prior, names: ["Slider", "Fries"], emptyBecause: null } satisfies MixData)

    expect(p.big).toEqual({ label: "Items sold", value: "200", sub: "2.0 items per order" })
    expect(p.vs?.tone).toBe("flat")
    expect(p.sentence).toContain("200 items sold, the same as the window before.")
    expect(p.sentence).toContain("People bought more Slider and less Fries.")
    expect(p.sentence).toContain("ingredient costs did not move it and menu prices did not move it")
    expect(p.bridge.map((b) => b.key)).toEqual(["mix", "cost", "price", "total"])
    expect(p.bridge[0].value).toBe(p.bridge[3].value)
    expect(p.moved).toEqual([
      { key: "Slider", name: "Slider", change: "▲ 50%", up: true },
      { key: "Fries", name: "Fries", change: "▼ 50%", up: false },
    ])
  })

  it("with no window before, says the count only and draws no bridge", () => {
    const now = win(10, { Slider: unit(30, 3, 10) })
    const p = plainOf({ now, prior: null, names: ["Slider"], emptyBecause: null })
    expect(p.sentence).toBe("30 items sold.")
    expect(p.vs).toBeNull()
    expect(p.bridge).toEqual([])
    expect(p.moved).toEqual([])
  })

  it("never calls a move on too few plates", () => {
    const prior = win(10, { Shake: unit(5, 1, 6) })
    const now = win(10, { Shake: unit(15, 1, 6) })
    expect(plainOf({ now, prior, names: ["Shake"], emptyBecause: null }).moved).toEqual([])
  })
})
