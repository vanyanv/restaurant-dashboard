import { describe, expect, it } from "vitest"
import {
  COST_SPIKE_THRESHOLD,
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

  it("uses a threshold of 8 by default", () => {
    expect(COST_SPIKE_THRESHOLD).toBe(8)
    // Exactly 8x the baseline is allowed; just over 8x is rejected.
    expect(selectNonSpikeCostIndex([8, 1, 1, 1])).toEqual({
      index: 0,
      rejectedSpike: false,
    })
    expect(selectNonSpikeCostIndex([8.01, 1, 1, 1])).toEqual({
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
})
