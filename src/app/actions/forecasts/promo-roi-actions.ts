"use server"

import { startOfDayUTC as startOfDayUtc } from "@/lib/date-utils"
// F17 — Promotion ROI. We don't have a "Promotion" entity in the schema, so
// we infer past promotional days from elevated daily discount share in
// OtterDailySummary. For each detected promo day:
//
//   counterfactual = median net-sales of same-weekday non-promo days in window
//   lift           = actual_net_sales − counterfactual
//   roi            = lift / discount_dollars  (return per dollar discounted)
//
// 80% CI on lift is ±1.28 × (baseline std / √n) around the baseline mean.
//
// Caveats baked into the data shape (do NOT silently fix in callers):
//   - Order-level discount only — per-item promo attribution isn't possible
//     because OtterMenuItem has no discount field. Cannibalization detection
//     therefore intentionally omitted.
//   - Discounts include loyalty + comps + actual campaigns; we can't split
//     them from this signal alone. Operator interpretation required.

import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { getCachedSession, resolveStoreContext } from "./_shared"

/**
 * The discount given that day, as a POSITIVE amount.
 *
 * `OtterDailySummary.fpDiscounts` / `.tpDiscounts` are stored as SIGNED
 * DEDUCTIONS, the same convention as `OtterOrder.discount` /`.commission`
 * (`src/lib/counter/order-signs.ts`). Counted on the live database
 * 2026-08-26, over all 3,430 rows:
 *
 *   fpDiscounts   > 0:     0    < 0:   335
 *   tpDiscounts   > 0:     0    < 0: 1,110
 *   fp + tp       > 0:     0    < 0: 1,445
 *
 * So `d.discount > 0` — the test this function replaces — was false for every
 * day in the table, and `getPromoRoi` returned `events: []`, `totalLift: 0`,
 * `blendedRoi: null` in production, always. `getPromoOpportunities` forwards
 * that to the model, which then tells the owner the store has run no
 * promotions. Every fixture in the test beside this file used the positive
 * shape, which is why it passed review.
 *
 * `Math.max(0, …)` rather than a bare negation, for the same reason
 * `feeAmount` uses it: were the column's convention ever to flip, reporting no
 * discount is the safe reading — a negated positive would report a NEGATIVE
 * discount and turn every ROI upside down.
 */
function discountGiven(fp: number | null, tp: number | null): number {
  return Math.max(0, -((fp ?? 0) + (tp ?? 0)))
}

const DEFAULT_LOOKBACK_DAYS = 90
const PROMO_DISCOUNT_PCT_MIN_ABSOLUTE = 0.03
const PROMO_BASELINE_MULTIPLIER = 1.5

export interface PromoEvent {
  date: Date
  weekday: number
  grossSales: number
  netSales: number
  /** Dollars discounted that day, as a POSITIVE amount. See `discountGiven`. */
  discount: number
  discountPct: number
  baselineNetSales: number
  baselineSampleSize: number
  baselineStd: number
  lift: number
  roi: number | null
  liftCI80Low: number
  liftCI80High: number
}

export interface PromoRoiData {
  storeId: string | null
  storeName: string | null
  windowStart: Date
  windowEnd: Date
  events: PromoEvent[]
  totalLift: number
  totalDiscount: number
  blendedRoi: number | null
}

export type GetPromoRoiResult =
  | { ok: true; data: PromoRoiData }
  | { ok: false; error: "store_not_in_account" | "no_data" }

export async function getPromoRoi(input: {
  storeId?: string
  lookbackDays?: number
  asOf?: Date
}): Promise<GetPromoRoiResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDayUtc(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays)

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) return resolved
  const { storeIds, storeName, storeIdOut: storeId } = resolved.ctx

  if (storeIds.length === 0) return { ok: false, error: "no_data" }

  const dailyRows = await prisma.$queryRaw<
    Array<{
      date: Date
      fpDiscounts: number | null
      tpDiscounts: number | null
      fpNetSales: number | null
      tpNetSales: number | null
      fpGrossSales: number | null
      tpGrossSales: number | null
    }>
  >(Prisma.sql`
    SELECT
      "date",
      SUM(COALESCE("fpDiscounts", 0))::double precision AS "fpDiscounts",
      SUM(COALESCE("tpDiscounts", 0))::double precision AS "tpDiscounts",
      SUM(COALESCE("fpNetSales", 0))::double precision AS "fpNetSales",
      SUM(COALESCE("tpNetSales", 0))::double precision AS "tpNetSales",
      SUM(COALESCE("fpGrossSales", 0))::double precision AS "fpGrossSales",
      SUM(COALESCE("tpGrossSales", 0))::double precision AS "tpGrossSales"
    FROM "OtterDailySummary"
    WHERE "storeId" IN (${Prisma.join(storeIds)})
      AND "date" >= ${windowStart}
      AND "date" <= ${windowEnd}
    GROUP BY "date"
  `)

  if (dailyRows.length === 0) return { ok: false, error: "no_data" }

  const byDate = new Map<
    string,
    { date: Date; grossSales: number; netSales: number; discount: number }
  >()
  for (const row of dailyRows) {
    const key = (row.date as Date).toISOString().slice(0, 10)
    const bucket = byDate.get(key) ?? {
      date: row.date as Date,
      grossSales: 0,
      netSales: 0,
      discount: 0,
    }
    bucket.grossSales += (row.fpGrossSales ?? 0) + (row.tpGrossSales ?? 0)
    bucket.netSales += (row.fpNetSales ?? 0) + (row.tpNetSales ?? 0)
    // Positive from here down: `discount` is the amount GIVEN, so the
    // threshold test, the fallback denominator (`netSales + discount` is the
    // gross) and `lift / discount` all read the way they are written.
    bucket.discount += discountGiven(row.fpDiscounts, row.tpDiscounts)
    byDate.set(key, bucket)
  }

  const days = Array.from(byDate.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((d) => {
      const denom = d.grossSales > 0 ? d.grossSales : d.netSales + d.discount
      const discountPct = denom > 0 ? d.discount / denom : 0
      return { ...d, discountPct, weekday: d.date.getUTCDay() }
    })

  // Baseline discount % = median of all days (with or without discount).
  // Real campaigns push well above the steady loyalty drag baseline.
  const allPcts = days.map((d) => d.discountPct).sort((a, b) => a - b)
  const medianBaseline =
    allPcts.length > 0 ? allPcts[Math.floor(allPcts.length / 2)] : 0
  const promoThreshold = Math.max(
    PROMO_DISCOUNT_PCT_MIN_ABSOLUTE,
    medianBaseline * PROMO_BASELINE_MULTIPLIER,
  )

  const promoKeys = new Set<string>()
  const promos: typeof days = []
  for (const d of days) {
    if (d.discountPct >= promoThreshold && d.discount > 0) {
      promos.push(d)
      promoKeys.add(d.date.toISOString().slice(0, 10))
    }
  }

  const baselineByWeekday = new Map<number, number[]>()
  for (const d of days) {
    if (promoKeys.has(d.date.toISOString().slice(0, 10))) continue
    const list = baselineByWeekday.get(d.weekday) ?? []
    list.push(d.netSales)
    baselineByWeekday.set(d.weekday, list)
  }

  const events: PromoEvent[] = promos.map((p) => {
    const samples = baselineByWeekday.get(p.weekday) ?? []
    const baselineMean = samples.length > 0 ? mean(samples) : 0
    const baselineStd = samples.length > 1 ? stdSample(samples) : 0
    const lift = p.netSales - baselineMean
    const roi = p.discount > 0 ? lift / p.discount : null
    const ciHalfWidth =
      samples.length > 0 ? 1.28 * (baselineStd / Math.sqrt(samples.length)) : 0
    return {
      date: p.date,
      weekday: p.weekday,
      grossSales: p.grossSales,
      netSales: p.netSales,
      discount: p.discount,
      discountPct: p.discountPct,
      baselineNetSales: baselineMean,
      baselineSampleSize: samples.length,
      baselineStd,
      lift,
      roi,
      liftCI80Low: lift - ciHalfWidth,
      liftCI80High: lift + ciHalfWidth,
    }
  })

  events.sort((a, b) => b.date.getTime() - a.date.getTime())

  const totalLift = events.reduce((s, e) => s + e.lift, 0)
  const totalDiscount = events.reduce((s, e) => s + e.discount, 0)
  const blendedRoi = totalDiscount > 0 ? totalLift / totalDiscount : null

  return {
    ok: true,
    data: {
      storeId,
      storeName,
      windowStart,
      windowEnd,
      events,
      totalLift,
      totalDiscount,
      blendedRoi,
    },
  }
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdSample(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

