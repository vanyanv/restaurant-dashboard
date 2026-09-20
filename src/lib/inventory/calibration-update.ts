// applyCalibrationUpdatesForCount — runs once per StockCount, just before
// the count is marked COMPLETED. For each line that has a frozen
// estimatedQtyAtCount (the model's prediction at save time), derive the
// recount observation and upsert the per-(store, ingredient)
// IngredientModelState. See src/lib/inventory/calibration.ts for the math.
//
// The early return below is NOT the defect it looks like. It fires when no
// line on the count carries an expectation, and that is the correct outcome
// for a count with nothing to learn from: an expectation is measured from the
// last CLOSED count on the store, so the first count a store ever closes has
// none and teaches the model nothing. It becomes the anchor, and the next
// count against it arrives here with estimates on its lines.
//
// Where those estimates come from: `loadCountEntry` in
// @/lib/counter/adapters/stock-counts takes one per ingredient at
// `StockCount.startedAt`, and the entry form carries it down with each save.
// Until 2026-09-20 that adapter hard-coded `estimate: null`, so this function
// returned here on every count ever taken and IngredientModelState stayed
// empty — which in turn was read as proof that no estimate could be produced.
// Nothing in this file had to change to break that loop.

import { prisma } from "@/lib/prisma"
import { computeRunningOnHand } from "@/lib/inventory/running-on-hand"
import {
  applyRecountUpdate,
  deriveConfidenceLevel,
  initialModelState,
  type ModelStateCore,
} from "@/lib/inventory/calibration"

const DAY_MS = 24 * 60 * 60 * 1000

export async function applyCalibrationUpdatesForCount(stockCountId: string): Promise<void> {
  const count = await prisma.stockCount.findUnique({
    where: { id: stockCountId },
    select: {
      id: true,
      storeId: true,
      countedAt: true,
      lines: {
        select: {
          canonicalIngredientId: true,
          qtyInRecipeUnit: true,
          estimatedQtyAtCount: true,
        },
      },
    },
  })
  if (!count) return

  const linesWithEstimate = count.lines.filter(
    (l): l is typeof l & { estimatedQtyAtCount: number } =>
      l.estimatedQtyAtCount !== null && Number.isFinite(l.estimatedQtyAtCount),
  )
  if (linesWithEstimate.length === 0) return

  for (const line of linesWithEstimate) {
    const onHand = await computeRunningOnHand({
      storeId: count.storeId,
      ingredientId: line.canonicalIngredientId,
      asOf: count.countedAt,
    })
    if (!onHand) continue

    const observedDepletion =
      onHand.baseQty + onHand.deliveriesQty - onHand.adjustmentsQty - line.qtyInRecipeUnit
    const periodDays = onHand.baseAt
      ? Math.max(1, (count.countedAt.getTime() - onHand.baseAt.getTime()) / DAY_MS)
      : 7
    const weeklyThroughput = (observedDepletion * 7) / periodDays
    const residual = line.estimatedQtyAtCount - line.qtyInRecipeUnit

    const prior = await loadPriorState(count.storeId, line.canonicalIngredientId)
    const next = applyRecountUpdate(prior, {
      theoreticalDepletion: onHand.depletionQty,
      observedDepletion,
      residual,
      weeklyThroughput,
      occurredAt: count.countedAt,
    })
    const confidenceLevel = deriveConfidenceLevel(next)

    await prisma.ingredientModelState.upsert({
      where: {
        storeId_canonicalIngredientId: {
          storeId: count.storeId,
          canonicalIngredientId: line.canonicalIngredientId,
        },
      },
      create: {
        storeId: count.storeId,
        canonicalIngredientId: line.canonicalIngredientId,
        calibrationFactor: next.calibrationFactor,
        recountDeltaMean: next.recountDeltaMean,
        recountDeltaM2: next.recountDeltaM2,
        sampleSize: next.sampleSize,
        consecutiveTightWeeks: next.consecutiveTightWeeks,
        isGraduated: next.isGraduated,
        graduatedAt: next.graduatedAt,
        confidenceLevel,
        typicalWeeklyThroughput: weeklyThroughput,
        lastUpdatedAt: count.countedAt,
      },
      update: {
        calibrationFactor: next.calibrationFactor,
        recountDeltaMean: next.recountDeltaMean,
        recountDeltaM2: next.recountDeltaM2,
        sampleSize: next.sampleSize,
        consecutiveTightWeeks: next.consecutiveTightWeeks,
        isGraduated: next.isGraduated,
        graduatedAt: next.graduatedAt,
        confidenceLevel,
        typicalWeeklyThroughput: weeklyThroughput,
        lastUpdatedAt: count.countedAt,
      },
    })
  }
}

async function loadPriorState(storeId: string, canonicalIngredientId: string): Promise<ModelStateCore> {
  const row = await prisma.ingredientModelState.findUnique({
    where: { storeId_canonicalIngredientId: { storeId, canonicalIngredientId } },
    select: {
      calibrationFactor: true,
      recountDeltaMean: true,
      recountDeltaM2: true,
      sampleSize: true,
      consecutiveTightWeeks: true,
      isGraduated: true,
      graduatedAt: true,
    },
  })
  if (!row) return initialModelState()
  return {
    calibrationFactor: row.calibrationFactor,
    recountDeltaMean: row.recountDeltaMean,
    recountDeltaM2: row.recountDeltaM2,
    sampleSize: row.sampleSize,
    consecutiveTightWeeks: row.consecutiveTightWeeks,
    isGraduated: row.isGraduated,
    graduatedAt: row.graduatedAt,
  }
}
