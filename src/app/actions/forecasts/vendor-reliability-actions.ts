"use server"

import { startOfDayUTC as startOfDay } from "@/lib/date-utils"
// F27 — Vendor reliability scoring. Three metrics over the last 6 months:
//
//   1. lead-time CV    — std / mean of inter-invoice day gaps. High
//                        coefficient of variation = unreliable scheduling.
//   2. price volatility — average across canonical ingredients of the std of
//                        month-over-month unit-price changes (relative).
//                        High = unpredictable pricing.
//   3. order-volume CV  — std / mean of monthly invoice totals. Tells the
//                        operator if this vendor is a shock absorber or a
//                        steady commodity supplier.
//
// Composite reliability = 100 × (1 − clamp(mean(normalized metrics), 0, 1)).
// Higher = more reliable. Short-ship % isn't computable yet — we don't
// track promised vs delivered quantity below the invoice header.

import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { getCachedSession } from "./_shared"

export interface VendorReliabilityRow {
  vendorName: string
  vendorNameNormalized: string
  invoiceCount: number
  spend6mo: number
  meanLeadDays: number | null
  leadDayStd: number | null
  leadCV: number | null
  meanMonthlyTotal: number | null
  monthlyTotalCV: number | null
  /** Average of per-ingredient std-of-relative-monthly-price-change. */
  priceVolatility: number | null
  /** 0–100 composite. Higher = more reliable. */
  reliabilityScore: number
  /** "high" / "medium" / "low" / "insufficient_data". */
  band: VendorReliabilityBand
}

export type VendorReliabilityBand = "high" | "medium" | "low" | "insufficient_data"

export interface VendorReliabilityData {
  windowStart: Date
  windowEnd: Date
  rows: VendorReliabilityRow[]
}

export type GetVendorReliabilityResult =
  | { ok: true; data: VendorReliabilityData }
  | { ok: false; error: "no_data" }

export async function getVendorReliability(input: {
  lookbackDays?: number
  asOf?: Date
}): Promise<GetVendorReliabilityResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const lookback = input.lookbackDays ?? 180
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDay(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - lookback)

  const [invoices, lineItems] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        accountId: user.accountId,
        invoiceDate: { gte: windowStart, lte: windowEnd },
        isReturn: false,
      },
      select: {
        vendorName: true,
        invoiceDate: true,
        totalAmount: true,
      },
      orderBy: [{ vendorName: "asc" }, { invoiceDate: "asc" }],
    }),
    prisma.invoiceLineItem.findMany({
      where: {
        invoice: {
          accountId: user.accountId,
          invoiceDate: { gte: windowStart, lte: windowEnd },
          isReturn: false,
        },
        canonicalIngredientId: { not: null },
        unitPrice: { gt: 0 },
      },
      select: {
        canonicalIngredientId: true,
        unitPrice: true,
        invoice: { select: { vendorName: true, invoiceDate: true } },
      },
    }),
  ])

  if (invoices.length === 0) {
    return { ok: false, error: "no_data" }
  }

  type InvoiceRow = (typeof invoices)[number]
  const byVendor = new Map<string, { display: string; invoices: InvoiceRow[] }>()
  for (const inv of invoices) {
    const norm = normalizeVendorName(inv.vendorName)
    const bucket = byVendor.get(norm) ?? { display: inv.vendorName, invoices: [] }
    bucket.invoices.push(inv)
    byVendor.set(norm, bucket)
  }

  type LineRow = (typeof lineItems)[number]
  const linesByVendor = new Map<string, LineRow[]>()
  for (const line of lineItems) {
    const norm = normalizeVendorName(line.invoice.vendorName)
    const list = linesByVendor.get(norm) ?? []
    list.push(line)
    linesByVendor.set(norm, list)
  }

  const rows: VendorReliabilityRow[] = []
  for (const [norm, bucket] of byVendor) {
    const dates = bucket.invoices
      .map((i) => i.invoiceDate)
      .filter((d): d is Date => !!d)
      .map((d) => (d as Date).getTime())
      .sort((a, b) => a - b)
    const gaps = dates.slice(1).map((t, idx) => (t - dates[idx]) / 86_400_000)
    const meanLeadDays = gaps.length > 0 ? mean(gaps) : null
    const leadDayStd = gaps.length > 1 ? stdSample(gaps) : null
    const leadCV =
      meanLeadDays && meanLeadDays > 0 && leadDayStd != null
        ? leadDayStd / meanLeadDays
        : null

    // Monthly total CV
    const monthlyTotals = sumByMonth(bucket.invoices)
    const monthlyVals = Array.from(monthlyTotals.values())
    const meanMonthlyTotal =
      monthlyVals.length > 0 ? mean(monthlyVals) : null
    const monthlyTotalCV =
      monthlyVals.length > 1 && meanMonthlyTotal && meanMonthlyTotal > 0
        ? stdSample(monthlyVals) / meanMonthlyTotal
        : null

    // Price volatility per canonical ingredient
    const lines = linesByVendor.get(norm) ?? []
    const priceVolatility = computePriceVolatility(lines)

    const spend6mo = bucket.invoices.reduce((s, i) => s + i.totalAmount, 0)
    const invoiceCount = bucket.invoices.length

    const score = compositeScore({ leadCV, priceVolatility, monthlyTotalCV })
    const band = bandFor(score, invoiceCount)

    rows.push({
      vendorName: bucket.display,
      vendorNameNormalized: norm,
      invoiceCount,
      spend6mo,
      meanLeadDays,
      leadDayStd,
      leadCV,
      meanMonthlyTotal,
      monthlyTotalCV,
      priceVolatility,
      reliabilityScore: score,
      band,
    })
  }

  rows.sort((a, b) => b.spend6mo - a.spend6mo)

  return {
    ok: true,
    data: { windowStart, windowEnd, rows },
  }
}

function compositeScore(args: {
  leadCV: number | null
  priceVolatility: number | null
  monthlyTotalCV: number | null
}): number {
  // Each metric clamped to [0, 1]: 0 = perfectly stable, 1+ = very unstable.
  // Reasonable upper bands chosen empirically:
  //   leadCV         — 0 (perfectly periodic) to 1.0 (high noise)
  //   priceVolatility — 0 (no price moves) to 0.25 (25% moves are noise)
  //   monthlyTotalCV  — 0 to 1.0
  const components: number[] = []
  if (args.leadCV != null) components.push(clamp(args.leadCV, 0, 1))
  if (args.priceVolatility != null)
    components.push(clamp(args.priceVolatility / 0.25, 0, 1))
  if (args.monthlyTotalCV != null)
    components.push(clamp(args.monthlyTotalCV, 0, 1))
  if (components.length === 0) return 0
  const meanInstability = mean(components)
  return 100 * (1 - meanInstability)
}

function bandFor(score: number, invoiceCount: number): VendorReliabilityBand {
  if (invoiceCount < 4) return "insufficient_data"
  if (score >= 75) return "high"
  if (score >= 50) return "medium"
  return "low"
}

function computePriceVolatility(
  lines: { canonicalIngredientId: string | null; unitPrice: number; invoice: { invoiceDate: Date | null } }[],
): number | null {
  const byIngredient = new Map<string, { ym: string; price: number }[]>()
  for (const l of lines) {
    if (!l.canonicalIngredientId || !l.invoice.invoiceDate) continue
    const ym = (l.invoice.invoiceDate as Date).toISOString().slice(0, 7)
    const list = byIngredient.get(l.canonicalIngredientId) ?? []
    list.push({ ym, price: l.unitPrice })
    byIngredient.set(l.canonicalIngredientId, list)
  }

  const ingredientStds: number[] = []
  for (const list of byIngredient.values()) {
    const monthly = new Map<string, number[]>()
    for (const e of list) {
      const arr = monthly.get(e.ym) ?? []
      arr.push(e.price)
      monthly.set(e.ym, arr)
    }
    const monthlyMeans = Array.from(monthly.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, prices]) => mean(prices))
    if (monthlyMeans.length < 2) continue
    const mom: number[] = []
    for (let i = 1; i < monthlyMeans.length; i++) {
      const prev = monthlyMeans[i - 1]
      if (prev > 0) mom.push((monthlyMeans[i] - prev) / prev)
    }
    if (mom.length < 1) continue
    ingredientStds.push(
      mom.length > 1 ? stdSample(mom) : Math.abs(mom[0]),
    )
  }
  if (ingredientStds.length === 0) return null
  return mean(ingredientStds)
}

function sumByMonth(invoices: { invoiceDate: Date | null; totalAmount: number }[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const inv of invoices) {
    if (!inv.invoiceDate) continue
    const ym = (inv.invoiceDate as Date).toISOString().slice(0, 7)
    out.set(ym, (out.get(ym) ?? 0) + inv.totalAmount)
  }
  return out
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

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo
  if (x > hi) return hi
  return x
}

