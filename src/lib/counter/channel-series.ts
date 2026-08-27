import {
  SALES_CASH_CODE,
  SALES_CREDIT_CARDS_CODE,
  SALES_DOORDASH_CODE,
  SALES_GRUBHUB_CODE,
  SALES_UBER_CODE,
  UBER_COMMISSION_CODE,
  DOORDASH_COMMISSION_CODE,
} from "@/lib/pnl"
import { CHANNELS, type ChannelId } from "@/lib/counter/channels"
import { rowValues, type Statement } from "@/lib/counter/statement"

/**
 * The channel mix, off the statement that prints the headline.
 *
 * A-R1: the strip's "Net sales", these bands, the marketplace share, the
 * commission and the drill's cost sentence all come from ONE `loadStatement`
 * call — the same `Statement.rows` / `Statement.periods` `buildSalesChart`
 * already reads in the Overview adapter. This module does not call
 * `loadChannelMix`: that answers in Otter's NET, and the P&L's sales lines are
 * GROSS — two different "net sales" on one page is the shape A-R1 exists to
 * forbid. Gross is also the basis the P&L actually charges commission on
 * (`commission = rate × gross`), which is why the drill's "what the mix cost"
 * sentence is exact on this basis.
 *
 * There is no rates parameter anywhere below. `getAllStoresPnL` already
 * computes `COM_UBER` / `COM_DD` per period and `consolidateRows` merges them
 * by code across stores, so the rate this account actually charges is
 * derivable from the same rollup that printed the headline (A-R14). Reading
 * `Store.uberCommissionRate` again here would be a second source for a number
 * the statement already holds, and the two could disagree the moment a rate
 * changes mid-range.
 */

/** One channel's line through the range, bucket by bucket. */
export interface ChannelBand {
  channel: ChannelId
  /** The channel's own name — "In-house", "DoorDash", "Uber Eats", "Grubhub". */
  name: string
  /** Sales per bucket, in the statement's own gross basis. Same length as periods. */
  values: number[]
  /** Share of the four-channel total per bucket, 0..100. Same length. */
  shares: number[]
  /** Sales across the whole range. */
  total: number
  /**
   * What this channel's marketplace kept over the range, or `null` where the
   * schema publishes no rate. `0` for the house channel — there is genuinely
   * no marketplace. NEVER `0` for Grubhub: see `channel-mix.ts`'s own note.
   */
  commission: number | null
}

export interface ChannelSeries {
  /** Bucket labels, straight off `Statement.periods`. */
  labels: string[]
  bands: ChannelBand[]
  /** The four-channel total across the range. The denominator every share uses. */
  total: number
  /** The house channel's total. */
  house: number
  /** `(total - house) / total * 100`. */
  marketplaceShare: number
  /** Commission across the rateable channels, in dollars. */
  commission: number
  /** Commission as a share of `total`, 0..100. */
  commissionPct: number
  /**
   * Commission as a share of the four-channel total, BUCKET BY BUCKET, 0..100
   * — the prototype's `R.feeNetPct()` (line 3501), which is what its strip
   * draws the commission sparkline from.
   *
   * Same length as `labels`, `0` (never `NaN`) where a bucket sold nothing.
   * Derived from the same NEGATIVE `COM_UBER` / `COM_DD` rows the range totals
   * come from, with the sign flipped exactly once — never from
   * `Store.uberCommissionRate` (A-R14). It therefore sums to `commission` and
   * its dollars-over-dollars reading over the whole range is `commissionPct`.
   */
  commissionShares: number[]
  /** Commission as a share of `total - house`, 0..100. `null` with no marketplace sales. */
  blendedPct: number | null
}

/** How a share moved between the first third of the range and the last. */
export interface Drift {
  /** `false` when the range holds fewer than three buckets (A-R10). */
  enough: boolean
  /** The first third's reading, 0..100. */
  was: number
  /** The last third's reading, 0..100. */
  now: number
  /** `now - was`, in points. */
  points: number
}

export interface MixMove {
  enough: boolean
  rows: MixMoveRow[]
  /** How the blended rate off the top moved, in points. */
  ratePoints: number
  /** `ratePoints / 100 * total` — dollars, signed. Positive is more commission. */
  cost: number
}

export interface MixMoveRow {
  channel: ChannelId
  name: string
  was: number
  now: number
  points: number
  /** The channel's own commission rate as a percent, or `null` where none is published. */
  rate: number | null
  /** True when this channel's move went the expensive way. */
  costly: boolean
}

/* ── Plumbing ─────────────────────────────────────────────────────────── */

const zeros = (n: number): number[] => new Array(n).fill(0)

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)

/** One or more GL rows, summed element-wise. A missing code contributes zeros. */
function bandValues(rows: Statement["rows"], n: number, ...codes: string[]): number[] {
  const out = zeros(n)
  for (const code of codes) {
    const values = rowValues(rows, code)
    if (!values) continue
    for (let i = 0; i < n; i++) out[i] += values[i] ?? 0
  }
  return out
}

/**
 * `-sum(rowValues(rows, code))`, i.e. the commission this GL row published as
 * a positive dollar figure. `computeStorePnL` writes these rows NEGATIVE
 * (`uberGross.map(g => -(g * rate))`), so the sign is flipped exactly once
 * here — never twice, never left alone. `0` when the code has no row at all
 * (a range with no sales on that channel has no commission either).
 */
function commissionFrom(rows: Statement["rows"], code: string): number {
  const values = rowValues(rows, code)
  return values ? -sum(values) : 0
}

/** A ratio-safe divide: `0` rather than `NaN` when the denominator is `0`. */
const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : (numerator / denominator) * 100

const sumAt = (values: number[], idxs: number[]): number =>
  idxs.reduce((acc, i) => acc + values[i], 0)

/**
 * A band's own commission RATE as a percent — the same number `mixMove` needs
 * to weight a share move by what it costs. `null` mirrors the band's own
 * `commission`: no published rate, no derivable rate. Never `Store`'s rate —
 * see the module note.
 */
function rateOf(band: ChannelBand): number | null {
  return band.commission === null ? null : ratio(band.commission, band.total)
}

/**
 * How thirds work (A-R10). `k = floor(n/3)`; below three buckets there is no
 * first third and no last third to compare, and a drift read off zero buckets
 * is a fabricated number.
 *
 * `reading` is summed across the buckets in each third and THEN divided — the
 * mean of per-bucket percentages would weight a slow Tuesday the same as a
 * busy Saturday.
 */
function thirds(bucketCount: number, reading: (idxs: number[]) => number): Drift {
  const k = Math.floor(bucketCount / 3)
  if (k < 1) return { enough: false, was: 0, now: 0, points: 0 }

  const first = Array.from({ length: k }, (_, i) => i)
  const last = Array.from({ length: k }, (_, i) => bucketCount - k + i)

  const was = reading(first)
  const now = reading(last)
  return { enough: true, was, now, points: now - was }
}

/* ── The series ───────────────────────────────────────────────────────── */

export function channelSeries(statement: Statement): ChannelSeries {
  const { rows, periods } = statement
  const n = periods.length
  const labels = periods.map((p) => p.label)

  const valuesByChannel: Record<ChannelId, number[]> = {
    house: bandValues(rows, n, SALES_CREDIT_CARDS_CODE, SALES_CASH_CODE),
    doordash: bandValues(rows, n, SALES_DOORDASH_CODE),
    ubereats: bandValues(rows, n, SALES_UBER_CODE),
    grubhub: bandValues(rows, n, SALES_GRUBHUB_CODE),
  }

  const commissionByChannel: Record<ChannelId, number | null> = {
    house: 0,
    doordash: commissionFrom(rows, DOORDASH_COMMISSION_CODE),
    ubereats: commissionFrom(rows, UBER_COMMISSION_CODE),
    // The schema publishes NO Grubhub rate. `0` would claim Grubhub works for
    // free; `null` is "we do not know", which is what this is.
    grubhub: null,
  }

  // A bucket's four-channel total, precomputed once so every share and every
  // drift reads the same denominator.
  const bucketTotals = Array.from({ length: n }, (_, i) =>
    valuesByChannel.house[i] +
    valuesByChannel.doordash[i] +
    valuesByChannel.ubereats[i] +
    valuesByChannel.grubhub[i]
  )

  const bands: ChannelBand[] = CHANNELS.map((c) => {
    const values = valuesByChannel[c.id]
    return {
      channel: c.id,
      name: c.name,
      values,
      // A bucket whose four-channel total is 0 gets a share of 0, not NaN.
      shares: values.map((v, i) => ratio(v, bucketTotals[i])),
      total: sum(values),
      commission: commissionByChannel[c.id],
    }
  })

  const total = sum(bucketTotals)
  const house = bands.find((b) => b.channel === "house")!.total
  const marketplaceShare = ratio(total - house, total)

  const commission = bands.reduce((acc, b) => acc + (b.commission ?? 0), 0)
  const commissionPct = ratio(commission, total)
  const marketplaceTotal = total - house
  const blendedPct = marketplaceTotal === 0 ? null : ratio(commission, marketplaceTotal)

  // The per-bucket commission, off the SAME two GL rows the range totals read,
  // negated once (`computeStorePnL` writes them negative). Grubhub publishes no
  // commission row at all, so it contributes nothing to the numerator while its
  // sales still count in the denominator — the same convention `commissionFrom`
  // and `commissionDrift` already use, for the same reason.
  const commissionPerBucket = bandValues(
    rows,
    n,
    DOORDASH_COMMISSION_CODE,
    UBER_COMMISSION_CODE,
  ).map((v) => -v)
  const commissionShares = commissionPerBucket.map((v, i) => ratio(v, bucketTotals[i]))

  return {
    labels,
    bands,
    total,
    house,
    marketplaceShare,
    commission,
    commissionPct,
    commissionShares,
    blendedPct,
  }
}

/* ── Drift ────────────────────────────────────────────────────────────── */

function perBucketTotal(series: ChannelSeries): number[] {
  const n = series.labels.length
  return Array.from({ length: n }, (_, i) =>
    series.bands.reduce((acc, b) => acc + b.values[i], 0)
  )
}

export function marketplaceDrift(series: ChannelSeries): Drift {
  const bucketTotals = perBucketTotal(series)
  const houseValues = series.bands.find((b) => b.channel === "house")!.values
  const marketplace = bucketTotals.map((t, i) => t - houseValues[i])

  return thirds(series.labels.length, (idxs) =>
    ratio(sumAt(marketplace, idxs), sumAt(bucketTotals, idxs))
  )
}

export function commissionDrift(series: ChannelSeries): Drift {
  const bucketTotals = perBucketTotal(series)

  // A band's commission is one number for the whole range; the per-bucket
  // dollar figure a third's reading needs is that band's own rate — constant
  // across the range — applied to the bucket's own sales. A band with no
  // published rate (`null`) contributes nothing to the numerator: it is not
  // that its commission is known to be zero, only that this reading cannot
  // price it, and the denominator (bucketTotals) still counts its sales.
  const perBucketCommission = Array.from({ length: series.labels.length }, (_, i) =>
    series.bands.reduce((acc, b) => {
      const rate = rateOf(b)
      return acc + (rate === null ? 0 : (b.values[i] * rate) / 100)
    }, 0)
  )

  return thirds(series.labels.length, (idxs) =>
    ratio(sumAt(perBucketCommission, idxs), sumAt(bucketTotals, idxs))
  )
}

export function mixMove(series: ChannelSeries): MixMove {
  const bucketCount = series.labels.length
  const k = Math.floor(bucketCount / 3)
  if (k < 1) return { enough: false, rows: [], ratePoints: 0, cost: 0 }

  const bucketTotals = perBucketTotal(series)
  const first = Array.from({ length: k }, (_, i) => i)
  const last = Array.from({ length: k }, (_, i) => bucketCount - k + i)
  const firstTotal = sumAt(bucketTotals, first)
  const lastTotal = sumAt(bucketTotals, last)

  const rows: MixMoveRow[] = series.bands.map((b) => {
    const was = ratio(sumAt(b.values, first), firstTotal)
    const now = ratio(sumAt(b.values, last), lastTotal)
    const points = now - was
    const rate = rateOf(b)
    // Costly when this channel's own share move pushed the blended rate the
    // expensive way — a `null`/`0` rate (Grubhub, house) never is, whichever
    // way its share moved, because it has no price to move.
    const costly = points * (rate ?? 0) > 0
    return { channel: b.channel, name: b.name, was, now, points, rate, costly }
  })

  // The blended rate off the top is `Σ share_i × rate_i`, so its DRIFT is
  // `Σ Δshare_i × rate_i` — exactly the per-row contributions, summed. A
  // `null`-rate row contributes `0`, the same convention `commissionDrift`
  // uses for the same reason.
  const ratePoints = rows.reduce((acc, r) => acc + (r.points * (r.rate ?? 0)) / 100, 0)
  const cost = (ratePoints / 100) * series.total

  return { enough: true, rows, ratePoints, cost }
}
