import { describe, expect, it } from "vitest"
import {
  COST_SPIKE_THRESHOLD,
  establishedCost,
  selectNonSpikeCostIndex,
} from "@/lib/invoice-line-shape"

describe("selectNonSpikeCostIndex", () => {
  it("keeps the newest line when prices are stable", () => {
    // costs newest-first; all ~equal, no spike.
    const result = selectNonSpikeCostIndex([0.4, 0.41, 0.39, 0.4])
    expect(result).toEqual({ index: 0, rejectedSpike: false })
  })

  it("rejects a newest line that spikes far above its older history", () => {
    // The house-sauce case: a mis-parsed line is ~180x the established price.
    // Older history is a stable ~0.40; the newest 72.59 must be rejected and
    // the next in-tolerance line (index 1) chosen instead.
    const result = selectNonSpikeCostIndex([72.59, 0.4, 0.4, 0.4, 0.4])
    expect(result).toEqual({ index: 1, rejectedSpike: true })
  })

  it("skips multiple consecutive spikes back to the last good line", () => {
    // Two bad lines (Jun 22 + Jun 27), four good. Median of older history stays
    // ~0.40, so both spikes are rejected and the first good line (index 2) wins.
    const result = selectNonSpikeCostIndex([72.59, 72.59, 0.4, 0.4, 0.4, 0.4])
    expect(result).toEqual({ index: 2, rejectedSpike: true })
  })

  it("allows a genuine moderate price increase (under the threshold)", () => {
    // A real ~2x supply-shock increase must NOT be rejected.
    const result = selectNonSpikeCostIndex([0.9, 0.45, 0.45, 0.45])
    expect(result).toEqual({ index: 0, rejectedSpike: false })
  })

  it("accepts the only line when there is no history to compare against", () => {
    const result = selectNonSpikeCostIndex([99.99])
    expect(result).toEqual({ index: 0, rejectedSpike: false })
  })

  it("returns index 0 for an empty list", () => {
    const result = selectNonSpikeCostIndex([])
    expect(result).toEqual({ index: 0, rejectedSpike: false })
  })

  it("ignores non-positive/non-finite costs when forming the baseline", () => {
    // A zero/garbage older value must not poison the median and wrongly pass a spike.
    const result = selectNonSpikeCostIndex([50, 0, 0.4, 0.4, 0.4])
    expect(result).toEqual({ index: 2, rejectedSpike: true })
  })

  it("uses a threshold of 5 by default", () => {
    expect(COST_SPIKE_THRESHOLD).toBe(5)
    // Exactly 5x the baseline is allowed; just over 5x is rejected.
    expect(selectNonSpikeCostIndex([5, 1, 1, 1])).toEqual({
      index: 0,
      rejectedSpike: false,
    })
    expect(selectNonSpikeCostIndex([5.01, 1, 1, 1])).toEqual({
      index: 1,
      rejectedSpike: true,
    })
  })

  it("honors a custom threshold", () => {
    expect(selectNonSpikeCostIndex([6, 1, 1, 1], 5)).toEqual({
      index: 1,
      rejectedSpike: true,
    })
  })

  it("rejects a newest line that collapses far below its older history", () => {
    // The mirror-image mis-parse: packSize over-applied makes an ingredient
    // look ~10x cheaper. Older history is a stable 0.40; 0.04 must be
    // rejected and the next in-tolerance line chosen instead.
    const result = selectNonSpikeCostIndex([0.04, 0.4, 0.4, 0.4, 0.4])
    expect(result).toEqual({ index: 1, rejectedSpike: true })
  })

  it("skips multiple consecutive downward spikes back to the last good line", () => {
    const result = selectNonSpikeCostIndex([0.01, 0.01, 0.4, 0.4, 0.4])
    expect(result).toEqual({ index: 2, rejectedSpike: true })
  })

  it("allows a genuine moderate price decrease (within the threshold)", () => {
    // A real ~2x price drop (vendor switch, case deal) must NOT be rejected.
    const result = selectNonSpikeCostIndex([0.45, 0.9, 0.9, 0.9])
    expect(result).toEqual({ index: 0, rejectedSpike: false })
  })

  it("applies the same 5x threshold symmetrically on the low side", () => {
    // Exactly 1/5 of the baseline is allowed; just under is rejected.
    expect(selectNonSpikeCostIndex([0.2, 1, 1, 1])).toEqual({
      index: 0,
      rejectedSpike: false,
    })
    expect(selectNonSpikeCostIndex([0.199, 1, 1, 1])).toEqual({
      index: 1,
      rejectedSpike: true,
    })
  })

  it("judges against the trusted price, not against older misreads (IFS 9x6 foam, 2026-10)", () => {
    // Newest first, $/each: the bagasse line read as 2×9 CT ($2.51), then the
    // new SKU read as 1 EA / 1 CT ($15.36) three times, then months of the
    // real 2×100 CT case ($0.1536). The old guard compared each misread with
    // the median of the eight lines after it — mostly misreads — and booked
    // $2.51. The established price is the one most readings agree on.
    const costs = [2.51, 15.36, 15.36, 15.36, ...Array(20).fill(0.1536)]
    expect(selectNonSpikeCostIndex(costs)).toEqual({ index: 4, rejectedSpike: true })
  })

  it("never lets a run of misreads vouch for itself", () => {
    // Five misreads in a row on top of six good readings: each misread agrees
    // with the misreads before it, but none of them is ever trusted.
    const costs = [15, 15, 15, 15, 15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15]
    expect(selectNonSpikeCostIndex(costs)).toEqual({ index: 5, rejectedSpike: true })
  })

  it("prefers the older reading when two disagree and there is nothing else", () => {
    // One reading each way: the price that came first is the established one.
    expect(selectNonSpikeCostIndex([15.36, 0.1536])).toEqual({ index: 1, rejectedSpike: true })
  })

  it("follows a real price that rises gradually past 5x of where it started", () => {
    // 1 → 2 → 4 → 8 over many deliveries: every step is ordinary, and the
    // trusted median moves with it.
    const costs = [8, 8, 8, 4, 4, 4, 2, 2, 2, 1, 1, 1].slice()
    expect(selectNonSpikeCostIndex(costs)).toEqual({ index: 0, rejectedSpike: false })
  })
})

describe("establishedCost", () => {
  it("is the price most readings agree on", () => {
    expect(establishedCost([2.51, 15.36, 15.36, 0.15, 0.15, 0.15, 0.15])).toBeCloseTo(0.15)
  })
  it("is null for no readings", () => {
    expect(establishedCost([])).toBeNull()
  })
})
