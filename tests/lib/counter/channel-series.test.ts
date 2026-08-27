/**
 * channelSeries / marketplaceDrift / commissionDrift / mixMove — the channel
 * mix off the statement that prints the headline (A-R1, A-R14).
 *
 * The fixture below is built from "The measured data" table in
 * docs/superpowers/plans/2026-08-27-counter-analytics-fidelity.md — the d7
 * window 2026-08-20 … 2026-08-26, Hollywood. That table gives each day's
 * channel shares to one decimal and the day's all-platform dollar total to
 * the nearest dollar; it does not give per-day cents. So each day's four
 * channel dollar figures are derived from its share row and its own day
 * total, then every channel's seven days are scaled by one constant factor so
 * the RANGE total matches the plan's own to-the-cent figure exactly (house
 * 15055.23, Uber 31659.20, DoorDash 19828.93, Grubhub 542.02). The scale
 * factors are all within 0.007% of 1 (Grubhub, the smallest band, is furthest
 * out at 1.7%), so this does not manufacture the range total — it distributes
 * a rounding remainder of a few cents a day across the real daily shape.
 * Commission is the plan's own published rates: Uber 21%, DoorDash 25%.
 */
import { describe, it, expect, vi } from "vitest"

// `statement.ts` imports `getAllStoresPnL`, which imports `@/lib/auth` →
// `@/lib/prisma` at MODULE LOAD — that throws without `DATABASE_URL`. This
// module is pure and never calls it; the mock only keeps the import graph
// from crashing at load time, same as `statement.test.ts`.
vi.mock("@/app/actions/store/pnl-actions", () => ({ getAllStoresPnL: vi.fn() }))

import type { PnLRow, Period } from "@/lib/pnl"
import type { Statement } from "@/lib/counter/statement"
import { CHANNELS } from "@/lib/counter/channels"
import {
  channelSeries,
  marketplaceDrift,
  commissionDrift,
  mixMove,
  type ChannelSeries,
} from "@/lib/counter/channel-series"

/* ── The measured window, 2026-08-20 … 2026-08-26 ────────────────────── */

const LABELS = [
  "2026-08-20",
  "2026-08-21",
  "2026-08-22",
  "2026-08-23",
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
]

const HOUSE = [2313.636904, 2120.027774, 2847.214089, 2854.141559, 1649.451861, 1694.288902, 1576.468911]
const UBER = [4324.664592, 4547.102761, 4638.65877, 5466.33505, 5358.149132, 3833.068698, 3491.220996]
const DOORDASH = [2215.675078, 3100.680267, 3124.362048, 3676.393255, 2948.917262, 2776.188565, 1986.713526]
const GRUBHUB = [43.726191, 116.831194, 41.919746, 106.968476, 9.824388, 74.1871, 148.562905]

// `computeStorePnL` writes these NEGATIVE: `uberGross.map(g => -(g * rate))`.
const UBER_COMMISSION = UBER.map((v) => -(v * 0.21))
const DOORDASH_COMMISSION = DOORDASH.map((v) => -(v * 0.25))

function periods(labels: string[]): Period[] {
  return labels.map((label) => ({
    label,
    startDate: new Date(label),
    endDate: new Date(label),
    days: 1,
    isPartial: false,
  }))
}

/** A `PnLRow[]` carrying exactly the codes `channel-series.ts` reads. */
function rows(over: Partial<Record<string, number[]>> = {}): PnLRow[] {
  const base: Record<string, number[]> = {
    "4010": HOUSE,
    "4011": HOUSE.map(() => 0),
    "4012": UBER,
    "4013": DOORDASH,
    "4014": GRUBHUB,
    COM_UBER: UBER_COMMISSION,
    COM_DD: DOORDASH_COMMISSION,
    ...over,
  }
  return Object.entries(base).map(([code, values]) => ({
    code,
    label: code,
    values,
    percents: values.map(() => 0),
  }))
}

function statement(over: {
  rows?: PnLRow[]
  labels?: string[]
} = {}): Statement {
  const labels = over.labels ?? LABELS
  return {
    rows: over.rows ?? rows(),
    periods: periods(labels),
  } as Statement
}

const band = (series: ChannelSeries, channel: string) =>
  series.bands.find((b) => b.channel === channel)!

describe("channelSeries", () => {
  it("totals each band across the range (assertion 1)", () => {
    const series = channelSeries(statement())
    expect(band(series, "house").total).toBeCloseTo(15055.23, 2)
    expect(band(series, "ubereats").total).toBeCloseTo(31659.2, 2)
    expect(band(series, "doordash").total).toBeCloseTo(19828.93, 2)
    expect(band(series, "grubhub").total).toBeCloseTo(542.02, 2)
    expect(series.total).toBeCloseTo(67085.38, 2)
  })

  it("reads marketplaceShare as 77.6% (assertion 2)", () => {
    const series = channelSeries(statement())
    expect(series.marketplaceShare).toBeCloseTo(77.6, 1)
  })

  it("reads commission, commissionPct and blendedPct (assertion 3)", () => {
    const series = channelSeries(statement())
    expect(series.commission).toBeCloseTo(11605.66, 2)
    expect(series.commissionPct).toBeCloseTo(17.3, 1)
    expect(series.blendedPct).toBeCloseTo(22.3, 1)
  })

  it("sums every bucket's four shares to 100 (assertion 4)", () => {
    const series = channelSeries(statement())
    for (let i = 0; i < LABELS.length; i++) {
      const bucketSum = series.bands.reduce((acc, b) => acc + b.shares[i], 0)
      expect(bucketSum).toBeCloseTo(100, 2)
    }
  })

  it("returns bands in CHANNELS order even when the input rows are shuffled (assertion 5)", () => {
    const shuffled = [...rows()].reverse()
    const series = channelSeries(statement({ rows: shuffled }))
    expect(series.bands.map((b) => b.channel)).toEqual(CHANNELS.map((c) => c.id))
  })

  it("reports grubhub.commission as null, not 0 (assertion 6)", () => {
    const series = channelSeries(statement())
    const grubhub = band(series, "grubhub")
    expect(grubhub.commission).toBeNull()
    expect(grubhub.commission).not.toBe(0)
  })

  it("reports house.commission as 0 (assertion 7)", () => {
    const series = channelSeries(statement())
    expect(band(series, "house").commission).toBe(0)
  })

  it("never returns a negative commission — the stored GL rows are negative and the sign is flipped once", () => {
    const series = channelSeries(statement())
    expect(band(series, "ubereats").commission).toBeGreaterThan(0)
    expect(band(series, "doordash").commission).toBeGreaterThan(0)
    expect(series.commission).toBeGreaterThan(0)
  })
})

describe("marketplaceDrift", () => {
  it("reads the seven-bucket window's thirds (assertion 8)", () => {
    const series = channelSeries(statement())
    const drift = marketplaceDrift(series)
    expect(drift.enough).toBe(true)
    expect(drift.was).toBeCloseTo(76.4, 1)
    expect(drift.now).toBeCloseTo(79.0, 1)
    expect(drift.points).toBeCloseTo(2.6, 1)
  })
})

describe("mixMove", () => {
  it("reads the blended-rate drift and its dollar cost (assertion 9)", () => {
    const series = channelSeries(statement())
    const move = mixMove(series)
    expect(move.enough).toBe(true)
    expect(move.ratePoints).toBeCloseTo(0.52, 2)
    expect(Math.round(move.cost)).toBe(348)
  })
})

describe("below three buckets (A-R10)", () => {
  it("returns enough:false from marketplaceDrift, commissionDrift and mixMove for a two-bucket range (assertion 10)", () => {
    const twoBucketRows = rows({
      "4010": [HOUSE[0], HOUSE[1]],
      "4011": [0, 0],
      "4012": [UBER[0], UBER[1]],
      "4013": [DOORDASH[0], DOORDASH[1]],
      "4014": [GRUBHUB[0], GRUBHUB[1]],
      COM_UBER: [UBER_COMMISSION[0], UBER_COMMISSION[1]],
      COM_DD: [DOORDASH_COMMISSION[0], DOORDASH_COMMISSION[1]],
    })
    const series = channelSeries(statement({ rows: twoBucketRows, labels: LABELS.slice(0, 2) }))

    const marketplace = marketplaceDrift(series)
    const commission = commissionDrift(series)
    const move = mixMove(series)

    expect(marketplace.enough).toBe(false)
    expect(marketplace).toEqual({ enough: false, was: 0, now: 0, points: 0 })
    expect(commission.enough).toBe(false)
    expect(commission).toEqual({ enough: false, was: 0, now: 0, points: 0 })
    expect(move.enough).toBe(false)
    expect(move.rows).toEqual([])
    expect(move.ratePoints).toBe(0)
    expect(move.cost).toBe(0)
  })
})

describe("a bucket with zero sales on all four channels (assertion 11)", () => {
  it("yields a 0 share everywhere, never NaN", () => {
    const zeroLabels = [...LABELS, "2026-08-27"]
    const zeroRows = rows({
      "4010": [...HOUSE, 0],
      "4011": [...HOUSE.map(() => 0), 0],
      "4012": [...UBER, 0],
      "4013": [...DOORDASH, 0],
      "4014": [...GRUBHUB, 0],
      COM_UBER: [...UBER_COMMISSION, 0],
      COM_DD: [...DOORDASH_COMMISSION, 0],
    })
    const series = channelSeries(statement({ rows: zeroRows, labels: zeroLabels }))

    const lastBucket = zeroLabels.length - 1
    for (const b of series.bands) {
      expect(b.shares[lastBucket]).toBe(0)
    }

    for (const b of series.bands) {
      for (const share of b.shares) expect(Number.isNaN(share)).toBe(false)
      for (const value of b.values) expect(Number.isNaN(value)).toBe(false)
    }
    expect(Number.isNaN(series.total)).toBe(false)
    expect(Number.isNaN(series.marketplaceShare)).toBe(false)
    expect(Number.isNaN(series.commissionPct)).toBe(false)
  })
})
