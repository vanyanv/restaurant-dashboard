import { describe, it, expect } from "vitest"
import { buildLede, type LedeInput } from "@/lib/dashboard/lede"

function input(over: Partial<LedeInput> = {}): LedeInput {
  return {
    salesPacePct: -8.4,
    ordersPacePct: -11.2,
    weekdayLabel: "Thu",
    inProgress: true,
    laborPct: 0.22,
    baselineLaborPct: 0.208,
    totalSales: 4706,
    marginPct: 0.145,
    ...over,
  }
}

describe("buildLede", () => {
  it("withholds the whole lede when there is no trustworthy baseline", () => {
    expect(buildLede(input({ salesPacePct: null }))).toBeNull()
  })

  it("names the shortfall, the traffic and where it landed", () => {
    const lede = buildLede(input())!
    expect(lede.headline).toBe(
      "Sales are tracking 8.4% behind a normal Thursday. Orders moved with them, 11.2% down. Labor has not come down with them, so the shortfall is landing on profit."
    )
  })

  it("prices the labor gap from figures already on the page", () => {
    const lede = buildLede(input())!
    // 1.2 points of $4,706 is about $56.
    expect(lede.suggestion).toBe(
      "Labor is 1.2 points above its four-week share. Closing that gap is worth about $56 on today's profit."
    )
  })

  it("calls out a ticket-carried day when orders move the other way", () => {
    const lede = buildLede(
      input({ salesPacePct: 6.1, ordersPacePct: -4.2, laborPct: null })
    )!
    expect(lede.headline).toContain("6.1% ahead of a normal Thursday")
    expect(lede.headline).toContain("the ticket is carrying it")
  })

  it("says level rather than inventing a direction inside the noise floor", () => {
    const lede = buildLede(
      input({ salesPacePct: 0.7, ordersPacePct: -0.4, laborPct: null })
    )!
    expect(lede.headline).toBe("Sales are running level with a normal Thursday.")
  })

  it("drops the labor clause and the suggestion when labor has not settled", () => {
    const lede = buildLede(input({ laborPct: null }))!
    expect(lede.headline).not.toContain("Labor")
    expect(lede.suggestion).toBeNull()
  })

  it("drops the suggestion when labor is in line with its baseline", () => {
    const lede = buildLede(input({ laborPct: 0.209, baselineLaborPct: 0.208 }))!
    expect(lede.suggestion).toBeNull()
    expect(lede.headline).not.toContain("Labor")
  })

  it("credits labor when it came down with sales", () => {
    const lede = buildLede(input({ laborPct: 0.198, baselineLaborPct: 0.208 }))!
    expect(lede.headline).toContain("Labor came down with them, so the margin is holding")
    expect(lede.suggestion).toBeNull()
  })

  it("never claims the margin is holding on a losing day", () => {
    // Regression: labor 19.8% against a 20.8% baseline read "the margin is
    // holding" directly above a net profit of −$53.37.
    const lede = buildLede(
      input({ laborPct: 0.198, baselineLaborPct: 0.208, marginPct: -0.04 })
    )!
    expect(lede.headline).toContain("still under water")
    expect(lede.headline).not.toContain("holding")
  })

  it("says nothing about the margin when it has not settled", () => {
    const lede = buildLede(
      input({ laborPct: 0.198, baselineLaborPct: 0.208, marginPct: null })
    )!
    expect(lede.headline).toContain("Labor came down with them.")
    expect(lede.headline).not.toContain("margin")
  })

  it("cannot price the gap without sales, and says nothing rather than guessing", () => {
    const lede = buildLede(input({ totalSales: null }))!
    expect(lede.headline).toContain("landing on profit")
    expect(lede.suggestion).toBeNull()
  })

  it("falls back to a neutral comparison for a multi-day range", () => {
    const lede = buildLede(input({ weekdayLabel: "30 days", laborPct: null }))!
    expect(lede.headline).toContain("the same 30 days a month back")
    expect(lede.source).toContain("comparable ranges")
  })

  it("says which hours the comparison used", () => {
    expect(buildLede(input())!.source).toContain("same hours")
    expect(buildLede(input({ inProgress: false }))!.source).toContain("full days")
  })
})
