/**
 * 30-day price trend for one canonical ingredient.
 *
 * Points are bucketed by (vendor, unit, sku) and compared only inside a
 * bucket. The SKU term is what stops the ledger reporting a product switch as
 * inflation: `lamb potato fry ss 1/4 stealth` carries four SKUs across three
 * products (Lamb Weston $38.00 → a Vitco fry $33.12 → Simplot $28.00 →
 * $46.75), and a SKU-blind comparison of its endpoints compares two products
 * that were never the same item.
 *
 * `skuCount` travels with the trend so callers can mark an ingredient whose
 * history spans products — the figure may be right for one SKU while the
 * ingredient as a whole is not one thing.
 */
import type { IngredientTrend } from "@/types/recipe"

export type TrendPoint = {
  date: Date
  price: number
  vendor: string
  unit: string | null
  sku: string | null
}

export type CanonicalTrend = {
  trend: IngredientTrend | null
  /** Distinct SKUs across all points. Greater than 1 means multiple products. */
  skuCount: number
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/** Missing SKU/unit values need a stable key that cannot collide with a real one. */
const ABSENT = "∅"

export function computeTrendForPoints(
  points: TrendPoint[],
  nowMs: number
): CanonicalTrend {
  if (points.length === 0) return { trend: null, skuCount: 0 }

  const skus = new Set<string>()
  const buckets = new Map<string, TrendPoint[]>()

  for (const p of points) {
    const sku = p.sku?.trim() || null
    skus.add(sku ?? ABSENT)
    const key = `${p.vendor}|${p.unit ?? ABSENT}|${sku ?? ABSENT}`
    const arr = buckets.get(key) ?? []
    arr.push(p)
    buckets.set(key, arr)
  }

  const cutoffMs = nowMs - THIRTY_DAYS_MS
  let best: IngredientTrend | null = null

  for (const pts of buckets.values()) {
    if (pts.length < 2) continue
    const sorted = [...pts].sort((a, b) => b.date.getTime() - a.date.getTime())
    const latest = sorted[0]
    // Baseline is the newest point on or before (now - 30d). Without one we
    // would be calling a two-day swing a 30-day trend.
    const baseline = sorted.find((p) => p.date.getTime() <= cutoffMs)
    if (!baseline || baseline.price <= 0) continue
    const pctChange = ((latest.price - baseline.price) / baseline.price) * 100
    if (!Number.isFinite(pctChange)) continue

    if (best == null || Math.abs(pctChange) > Math.abs(best.pctChange)) {
      best = {
        pctChange,
        latestPrice: latest.price,
        baselinePrice: baseline.price,
        vendor: latest.vendor,
        unit: latest.unit,
        sku: latest.sku?.trim() || null,
        latestDate: latest.date.toISOString().slice(0, 10),
        baselineDate: baseline.date.toISOString().slice(0, 10),
      }
    }
  }

  return { trend: best, skuCount: skus.size }
}
