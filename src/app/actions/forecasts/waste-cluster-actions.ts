"use server"

// F29 — Waste root-cause clustering. For each (store, ingredient) with at
// least a few completed counts in the lookback window, classify the
// dominant residual pattern via the rule-based clusterer in
// `src/lib/inventory/waste-clustering.ts`. Surface counts grouped by
// cluster so the operator can act on patterns instead of reading every
// row.
//
// Residual definition:
//   residual = estimatedQtyAtCount − qtyInRecipeUnit  (positive = waste)
//
// We only consider lines where estimatedQtyAtCount is non-null — those are
// the lines populated by the calibration-update step (Phase 4). Earlier
// counts written before that pipeline existed are ignored.

import { prisma } from "@/lib/prisma"
import {
  classifyWastePattern,
  type WasteClassification,
  type WasteClusterLabel,
} from "@/lib/inventory/waste-clustering"
import { getCachedSession, resolveStoreContext } from "./_shared"

const DEFAULT_LOOKBACK_WEEKS = 12

export interface IngredientCluster {
  storeId: string
  /** Populated in aggregate mode (multiple stores in scope). */
  storeName?: string
  canonicalIngredientId: string
  ingredientName: string
  defaultUnit: string
  weeklyThroughput: number
  sampleSize: number
  classification: WasteClassification
  /** Estimated dollar exposure: |meanResidual| × costPerRecipeUnit × 52w. */
  annualizedDollarExposure: number | null
}

export interface WasteClusterData {
  storeId: string | null
  storeName: string | null
  windowStart: Date
  windowEnd: Date
  rows: IngredientCluster[]
  /** Cluster → ingredient count summary, for the card header. */
  summary: Record<WasteClusterLabel, number>
}

export type GetWasteClusterResult =
  | { ok: true; data: WasteClusterData }
  | { ok: false; error: "store_not_in_account" | "no_data" }

export async function getWasteRootCauses(input: {
  storeId?: string
  lookbackWeeks?: number
  asOf?: Date
}): Promise<GetWasteClusterResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const lookbackWeeks = input.lookbackWeeks ?? DEFAULT_LOOKBACK_WEEKS
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDayUtc(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - lookbackWeeks * 7)

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) return resolved
  const { storeName, storeNameById, storeIdOut: storeId } = resolved.ctx

  // Lines from completed counts in the window with a frozen estimate.
  const lines = await prisma.stockCountLine.findMany({
    where: {
      stockCount: {
        ...(storeId
          ? { storeId }
          : { store: { accountId: user.accountId } }),
        status: "COMPLETED",
        countedAt: { gte: windowStart, lte: windowEnd },
      },
      estimatedQtyAtCount: { not: null },
    },
    select: {
      canonicalIngredientId: true,
      qtyInRecipeUnit: true,
      estimatedQtyAtCount: true,
      stockCount: { select: { storeId: true, countedAt: true } },
    },
  })

  if (lines.length === 0) return { ok: false, error: "no_data" }

  const adjustments = await prisma.inventoryAdjustment.findMany({
    where: {
      ...(storeId ? { storeId } : { store: { accountId: user.accountId } }),
      occurredAt: { gte: windowStart, lte: windowEnd },
    },
    select: {
      storeId: true,
      canonicalIngredientId: true,
      reason: true,
      qty: true,
    },
  })

  const ingredientIds = Array.from(
    new Set(lines.map((l) => l.canonicalIngredientId)),
  )
  const ingredients = await prisma.canonicalIngredient.findMany({
    where: { id: { in: ingredientIds } },
    select: {
      id: true,
      name: true,
      defaultUnit: true,
      costPerRecipeUnit: true,
    },
  })
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]))

  const modelStates = await prisma.ingredientModelState.findMany({
    where: {
      ...(storeId ? { storeId } : { store: { accountId: user.accountId } }),
      canonicalIngredientId: { in: ingredientIds },
    },
    select: {
      storeId: true,
      canonicalIngredientId: true,
      typicalWeeklyThroughput: true,
    },
  })
  const throughputKey = (s: string, i: string) => `${s}::${i}`
  const throughputBy = new Map(
    modelStates.map((m) => [
      throughputKey(m.storeId, m.canonicalIngredientId),
      m.typicalWeeklyThroughput ?? 0,
    ]),
  )

  // Bucket residuals by (storeId, canonicalIngredientId)
  const bucketKey = throughputKey
  const buckets = new Map<
    string,
    {
      storeId: string
      canonicalIngredientId: string
      residuals: { date: Date; residual: number }[]
    }
  >()
  for (const l of lines) {
    if (l.estimatedQtyAtCount == null) continue
    const key = bucketKey(l.stockCount.storeId, l.canonicalIngredientId)
    const bucket = buckets.get(key) ?? {
      storeId: l.stockCount.storeId,
      canonicalIngredientId: l.canonicalIngredientId,
      residuals: [],
    }
    bucket.residuals.push({
      date: l.stockCount.countedAt as Date,
      residual: l.estimatedQtyAtCount - l.qtyInRecipeUnit,
    })
    buckets.set(key, bucket)
  }

  const adjustmentsBy = new Map<
    string,
    { reason: string; qty: number }[]
  >()
  for (const a of adjustments) {
    const key = bucketKey(a.storeId, a.canonicalIngredientId)
    const list = adjustmentsBy.get(key) ?? []
    list.push({ reason: a.reason as string, qty: a.qty })
    adjustmentsBy.set(key, list)
  }

  const rows: IngredientCluster[] = []
  const summary: Record<WasteClusterLabel, number> = {
    insufficient_data: 0,
    stable_within_noise: 0,
    systematic_overuse: 0,
    systematic_underuse: 0,
    expiry_driven: 0,
    theft_or_unrecorded: 0,
    improving: 0,
  }

  for (const bucket of buckets.values()) {
    bucket.residuals.sort((a, b) => a.date.getTime() - b.date.getTime())
    const residualSeries = bucket.residuals.map((r) => r.residual)
    const ingredient = ingredientById.get(bucket.canonicalIngredientId)
    const weeklyThroughput =
      throughputBy.get(
        bucketKey(bucket.storeId, bucket.canonicalIngredientId),
      ) ?? 0
    const adjsForKey =
      adjustmentsBy.get(
        bucketKey(bucket.storeId, bucket.canonicalIngredientId),
      ) ?? []

    const classification = classifyWastePattern({
      residuals: residualSeries,
      adjustments: adjsForKey,
      weeklyThroughput,
    })

    summary[classification.label] += 1

    const cost = ingredient?.costPerRecipeUnit ?? null
    const annualizedDollarExposure =
      cost != null
        ? Math.abs(classification.meanResidual) * cost * 52
        : null

    rows.push({
      storeId: bucket.storeId,
      ...(storeId == null && storeNameById.has(bucket.storeId)
        ? { storeName: storeNameById.get(bucket.storeId)! }
        : {}),
      canonicalIngredientId: bucket.canonicalIngredientId,
      ingredientName: ingredient?.name ?? bucket.canonicalIngredientId,
      defaultUnit: ingredient?.defaultUnit ?? "",
      weeklyThroughput,
      sampleSize: residualSeries.length,
      classification,
      annualizedDollarExposure,
    })
  }

  // Worst dollar exposure first.
  rows.sort(
    (a, b) =>
      (b.annualizedDollarExposure ?? 0) - (a.annualizedDollarExposure ?? 0),
  )

  return {
    ok: true,
    data: {
      storeId,
      storeName,
      windowStart,
      windowEnd,
      rows,
      summary,
    },
  }
}

function startOfDayUtc(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}
