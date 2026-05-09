// computeReorderRecommendation — pure function over (onHand, ratePerDay,
// leadDays). Returns days-of-cover, target reorder date, and a four-level
// status. No Prisma calls; the data-fetching is the caller's job.
//
//   daysOfCover = onHand / ratePerDay
//   safetyDays  = max(1, 0.5 × leadDays)
//   slackDays   = daysOfCover − leadDays − safetyDays
//   reorderBy   = asOf + slackDays
//
//   slackDays ≥ 3            → ok
//   0 ≤ slackDays < 3        → reorder_soon
//   −leadDays ≤ slackDays < 0 → reorder_now (we'll get it before stockout)
//   slackDays < −leadDays    → urgent (we'll be out before the next delivery)

import { describe, it, expect } from "vitest"
import {
  computeReorderRecommendation,
  type ReorderStatus,
} from "@/lib/inventory/reorder-recommendation"

const asOf = new Date("2026-05-08T00:00:00.000Z")

function daysAfter(d: Date, n: number) {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000)
}

describe("computeReorderRecommendation", () => {
  it("returns no_signal when ratePerDay is 0 (can't divide by zero / nothing's moving)", () => {
    const r = computeReorderRecommendation({ onHand: 10, ratePerDay: 0, leadDays: 2, asOf })
    expect(r.status).toBe<ReorderStatus>("no_signal")
    expect(r.daysOfCover).toBeNull()
    expect(r.reorderBy).toBeNull()
  })

  it("returns ok with plenty of slack when cover ≫ lead + safety", () => {
    // 20 lb on hand, 1 lb/day → 20 days cover; lead 2, safety 1, slack 17
    const r = computeReorderRecommendation({ onHand: 20, ratePerDay: 1, leadDays: 2, asOf })
    expect(r.status).toBe<ReorderStatus>("ok")
    expect(r.daysOfCover).toBe(20)
    expect(r.slackDays).toBe(17)
    expect(r.reorderBy?.getTime()).toBe(daysAfter(asOf, 17).getTime())
  })

  it("returns reorder_soon when slack is between 0 and 3", () => {
    // cover 5, lead 2, safety 1 → slack 2
    const r = computeReorderRecommendation({ onHand: 5, ratePerDay: 1, leadDays: 2, asOf })
    expect(r.status).toBe<ReorderStatus>("reorder_soon")
    expect(r.slackDays).toBe(2)
  })

  it("returns reorder_now when slack is negative but a delivery placed today still arrives in time", () => {
    // cover 2.5, lead 2, safety 1 → slack -0.5; -lead = -2; -2 ≤ -0.5 < 0 ⇒ reorder_now
    const r = computeReorderRecommendation({ onHand: 2.5, ratePerDay: 1, leadDays: 2, asOf })
    expect(r.status).toBe<ReorderStatus>("reorder_now")
    expect(r.slackDays).toBe(-0.5)
  })

  it("returns urgent when even a delivery placed today won't arrive before stockout", () => {
    // cover 1, lead 3, safety 1.5 → slack -3.5; -lead = -3; -3.5 < -3 ⇒ urgent
    const r = computeReorderRecommendation({ onHand: 1, ratePerDay: 1, leadDays: 3, asOf })
    expect(r.status).toBe<ReorderStatus>("urgent")
  })

  it("safetyDays floors at 1 day even when 0.5 × leadDays is smaller", () => {
    // leadDays=1 → safety should be 1 (not 0.5)
    const r = computeReorderRecommendation({ onHand: 4, ratePerDay: 1, leadDays: 1, asOf })
    expect(r.safetyDays).toBe(1)
    expect(r.slackDays).toBe(2) // cover 4 − lead 1 − safety 1
  })

  it("safetyDays scales as 0.5 × leadDays once that exceeds 1 day", () => {
    const r = computeReorderRecommendation({ onHand: 100, ratePerDay: 1, leadDays: 4, asOf })
    expect(r.safetyDays).toBe(2)
  })

  it("reorderBy is at least the same day as asOf when the math says we should already have ordered", () => {
    // Slack negative → reorderBy = asOf (you can't reorder in the past)
    const r = computeReorderRecommendation({ onHand: 1, ratePerDay: 1, leadDays: 2, asOf })
    expect(r.reorderBy!.getTime()).toBe(asOf.getTime())
  })

  it("returns no_signal when onHand is negative (model has drifted; refuse to recommend)", () => {
    const r = computeReorderRecommendation({ onHand: -2, ratePerDay: 1, leadDays: 2, asOf })
    expect(r.status).toBe<ReorderStatus>("no_signal")
  })
})
