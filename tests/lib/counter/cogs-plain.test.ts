import { describe, expect, it } from "vitest"
import { buildCogsPlain, type CogsPlainInput } from "@/lib/counter/cogs-plain"

const range = (over: Partial<CogsPlainInput> = {}): CogsPlainInput => ({
  cost: 31_900,
  sales: 109_600,
  foodPct: 29.1,
  plan: 28.2,
  againstPlan: 0.9,
  partialLines: 0,
  unmappedLines: 0,
  invoices: { count: 2, total: 3_400 },
  moves: [
    { key: "b", name: "Ground beef", then: 4.12, now: 4.86, change: 18 },
    { key: "l", name: "Lettuce", then: 1.2, now: 1.1, change: -8.3 },
    { key: "r", name: "Martin's rolls", then: 0.31, now: 0.34, change: 9.7 },
  ],
  ...over,
})

describe("buildCogsPlain", () => {
  it("says the share against plan, the biggest rise and the invoices waiting", () => {
    const p = buildCogsPlain(range())
    expect(p.sentence).toBe(
      "Food was 29.1% of sales, $31,900, 0.9 points over your 28.2% plan. The biggest price rise is Ground beef, $4.12 to $4.86 (▲ 18.0%). 2 invoices are still in review, so their prices are not in yet.",
    )
    expect(p.vs).toEqual({ change: "▲ 0.9 pts", tone: "down", against: "against the 28.2% plan" })
    expect(p.statuses).toEqual([
      { tone: "bad", text: "Over plan" },
      { tone: "warn", text: "2 invoices not in yet" },
    ])
    expect(p.invoices).toEqual({ what: "2 invoices in review, $3,400", href: "/dashboard/invoices" })
  })

  it("lists only rises in what went up", () => {
    expect(buildCogsPlain(range()).moved.map((m) => m.name)).toEqual(["Ground beef", "Martin's rolls"])
  })

  it("labels uncosted lines and a missing target rather than counting them as nothing", () => {
    const p = buildCogsPlain(range({ plan: null, againstPlan: null, partialLines: 3, unmappedLines: 1, invoices: null, moves: null }))
    expect(p.sentence).toBe(
      "Food was 29.1% of sales, $31,900. No food-cost target is set, so there is no plan to read it against. 4 sold lines are not fully costed, so the true cost is higher.",
    )
    expect(p.vs).toBeNull()
    expect(p.big.missing).toBe("4 not fully costed")
    expect(p.invoices).toBeNull()
  })

  it("reads under plan as good, and has no share without sales", () => {
    expect(buildCogsPlain(range({ againstPlan: -1.2 })).statuses[0]).toEqual({ tone: "good", text: "Under plan" })
    const p = buildCogsPlain(range({ foodPct: null, sales: 0, againstPlan: null }))
    expect(p.big.value).toBeNull()
    expect(p.sentence.startsWith("Food cost $31,900, with no sales in this range to set it against.")).toBe(true)
  })
})
