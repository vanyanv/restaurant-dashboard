import { describe, expect, it } from "vitest"
import { buildAnalyticsPlain, type AnalyticsPlainInput } from "@/lib/counter/analytics-plain"

const range = (over: Partial<AnalyticsPlainInput> = {}): AnalyticsPlainInput => ({
  sales: 109_607,
  vs: { text: "▲ 9.9% vs last week", tone: "is-up" },
  marketplaceShare: 68,
  commission: 17_900,
  channelTotal: 107_465,
  channels: [
    { name: "In-house", total: 33_513 },
    { name: "DoorDash", total: 40_143 },
    { name: "Uber Eats", total: 33_809 },
    { name: "Grubhub", total: 0 },
  ],
  best: { name: "Friday", average: 20_800, averaged: true },
  ...over,
})

describe("buildAnalyticsPlain", () => {
  it("says sales against the comparison, the best day and the apps' share in one sentence", () => {
    const p = buildAnalyticsPlain(range())
    expect(p.sentence).toBe(
      "Sales were $109,607 (▲ 9.9% vs last week). Friday is the best day, averaging $20,800. Delivery apps brought 68.0% of channel sales and took $17,900 in commission.",
    )
    expect(p.vs).toEqual({ change: "▲ 9.9%", tone: "up", against: "vs last week" })
  })

  it("lists channels that sold, biggest first, with their share", () => {
    const p = buildAnalyticsPlain(range())
    expect(p.channels.map((c) => [c.name, c.share, c.bar])).toEqual([
      ["DoorDash", "37.4%", 100],
      ["Uber Eats", "31.5%", 84],
      ["In-house", "31.2%", 83],
    ])
  })

  it("does not call a single day an average, and drops a missing comparison", () => {
    const p = buildAnalyticsPlain(range({ vs: null, best: { name: "Friday", average: 3_100, averaged: false } }))
    expect(p.sentence).toBe(
      "Sales were $109,607. Friday sold the most, $3,100. Delivery apps brought 68.0% of channel sales and took $17,900 in commission.",
    )
    expect(p.vs).toBeNull()
  })

  it("says plainly when nothing sold", () => {
    const p = buildAnalyticsPlain(range({ sales: 0, channelTotal: 0, channels: [], best: null, vs: null }))
    expect(p.sentence).toBe("No sales in this range yet.")
    expect(p.channels).toEqual([])
  })
})
