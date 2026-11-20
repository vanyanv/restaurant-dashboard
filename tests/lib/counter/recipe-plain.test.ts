import { describe, expect, it, vi } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { plainOf, type Loaded } from "@/lib/counter/adapters/recipe"
import type { RecipeCostLine } from "@/lib/recipe-cost"

const line = (name: string, quantity: number, unit: string, lineCost: number, missingCost = false): RecipeCostLine => ({
  kind: "ingredient",
  refId: name,
  name,
  quantity,
  unit,
  unitCost: null,
  lineCost,
  missingCost,
})

const loaded = (o: Partial<Loaded>): Loaded =>
  ({
    id: "r1",
    name: "Signature Slider",
    isConfirmed: true,
    lines: [],
    totalCost: 0,
    partial: false,
    emptyWalk: false,
    hasLines: true,
    overrideApplied: false,
    trend: [],
    soldQty: 0,
    revenue: 0,
    price: null,
    margin: null,
    rangeLabel: "Nov 9 – 15",
    servingSize: 1,
    bookedPlate: null,
    ...o,
  }) as Loaded

describe("one recipe made plain", () => {
  it("says what one costs, what it kept and its biggest line, costliest line first", () => {
    const p = plainOf(
      loaded({
        lines: [
          line("martin's roll", 1, "each", 0.55),
          line("ground beef", 1.5, "oz", 1.31),
          line("american cheese", 1, "slice", 0.28),
          line("pickles", 0.25, "oz", 0.08),
          line("sauce", 0.5, "oz", 0.15),
        ],
        totalCost: 2.37,
        price: 7.99,
        margin: 70.3,
        bookedPlate: 2.37,
        soldQty: 400,
        trend: [
          { date: "2026-10-29", cost: 2.17, qty: 10, partial: false },
          { date: "2026-11-05", cost: 9.99, qty: 10, partial: true },
          { date: "2026-11-18", cost: 2.37, qty: 10, partial: false },
        ],
      }),
    )
    expect(p.sentence).toBe(
      "One costs $2.37 today. Over Nov 9 – 15 it sold for $7.99 and kept 70.3% after the food cost booked then ($2.37 a plate). Ground Beef is $1.31 of it.",
    )
    expect(p.lines.map((l) => l.label)).toEqual([
      "Ground Beef · 1.5 oz",
      "Martin's Roll · 1 each",
      "American Cheese · 1 slice",
      "Sauce · 0.5 oz",
    ])
    expect(p.rest).toEqual({ n: 1, value: "$0.08" })
    // A partial day never moves the comparison; cost going up reads as bad.
    expect(p.vs).toEqual({ change: "▲ $0.20", tone: "down", against: "booked plate vs Oct 29" })
    expect(p.statuses).toEqual([
      { tone: "good", text: "Every line priced" },
      { tone: "good", text: "Confirmed" },
    ])
  })

  it("a recipe with no priced line costs $0 and says so, never a margin", () => {
    const p = plainOf(loaded({ emptyWalk: true, lines: [line("beef", 1, "oz", 0, true)], isConfirmed: false }))
    expect(p.sentence).toBe("One costs $0 today because no line on it has a price, so its food cost isn't counted.")
    expect(p.big.value).toBe("$0.00")
    expect(p.lines[0]).toMatchObject({ value: "no price", missing: true })
    expect(p.statuses.map((s) => s.text)).toEqual(["Costs $0", "Not confirmed"])
  })

  it("a batch recipe shows each line per serving, like its total", () => {
    const p = plainOf(loaded({ servingSize: 24, lines: [line("beef", 48, "oz", 48)], totalCost: 2 }))
    expect(p.lines[0]).toMatchObject({ label: "Beef · 2 oz", value: "$2.00" })
  })

  it("an unpriced line makes the cost a floor", () => {
    const p = plainOf(loaded({ lines: [line("beef", 1, "oz", 1.31), line("bun", 1, "each", 0, true)], totalCost: 1.31 }))
    expect(p.sentence).toBe("One costs at least $1.31 today. It did not sell over Nov 9 – 15. Beef is $1.31 of it. 1 line has no price yet.")
  })
})
