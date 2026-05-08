// Pure helper that computes median delivery cadence (in days) from a list of
// invoice dates for one (account, vendor). Used as a proxy for vendor lead
// time in reorder recommendations.
//
//   sampleSize = number of inter-invoice deltas (= invoices.length - 1)
//   medianLeadDays = median of those deltas
//
// When sampleSize < 3 we don't trust the signal and the caller is expected to
// fall back to a per-account default. The helper still returns the math so
// the caller can decide.

import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findMany: vi.fn() },
    vendorLeadTime: { upsert: vi.fn() },
  },
}))

import { computeMedianLeadDaysFromInvoices } from "@/lib/inventory/vendor-lead-time"

const d = (iso: string) => new Date(iso)

describe("computeMedianLeadDaysFromInvoices", () => {
  it("returns sampleSize 0 and null median when there are no invoices", () => {
    const r = computeMedianLeadDaysFromInvoices([])
    expect(r.sampleSize).toBe(0)
    expect(r.medianLeadDays).toBeNull()
  })

  it("returns sampleSize 0 and null median for a single invoice (no delta to measure)", () => {
    const r = computeMedianLeadDaysFromInvoices([d("2026-05-01")])
    expect(r.sampleSize).toBe(0)
    expect(r.medianLeadDays).toBeNull()
  })

  it("returns the lone delta when there are exactly two invoices", () => {
    const r = computeMedianLeadDaysFromInvoices([d("2026-05-01"), d("2026-05-04")])
    expect(r.sampleSize).toBe(1)
    expect(r.medianLeadDays).toBe(3)
  })

  it("returns the median when there's an odd number of deltas", () => {
    const r = computeMedianLeadDaysFromInvoices([
      d("2026-05-01"),
      d("2026-05-04"), // delta 3
      d("2026-05-06"), // delta 2
      d("2026-05-13"), // delta 7
    ])
    expect(r.sampleSize).toBe(3)
    expect(r.medianLeadDays).toBe(3)
  })

  it("averages the two middle values when there's an even number of deltas", () => {
    const r = computeMedianLeadDaysFromInvoices([
      d("2026-05-01"),
      d("2026-05-03"), // delta 2
      d("2026-05-06"), // delta 3
      d("2026-05-12"), // delta 6
      d("2026-05-22"), // delta 10
    ])
    expect(r.sampleSize).toBe(4)
    // sorted deltas: 2, 3, 6, 10 → median = (3 + 6) / 2 = 4.5
    expect(r.medianLeadDays).toBe(4.5)
  })

  it("sorts incoming dates so out-of-order input produces the same result", () => {
    const r = computeMedianLeadDaysFromInvoices([
      d("2026-05-13"),
      d("2026-05-01"),
      d("2026-05-04"),
      d("2026-05-06"),
    ])
    expect(r.sampleSize).toBe(3)
    expect(r.medianLeadDays).toBe(3)
  })

  it("dedupes same-day invoices (one delivery day = one observation)", () => {
    const r = computeMedianLeadDaysFromInvoices([
      d("2026-05-01"),
      d("2026-05-01"), // same day → deduped
      d("2026-05-04"),
    ])
    expect(r.sampleSize).toBe(1)
    expect(r.medianLeadDays).toBe(3)
  })
})
