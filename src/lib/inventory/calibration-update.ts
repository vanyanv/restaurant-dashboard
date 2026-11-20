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
//
// HOW MANY QUERIES THIS MAKES. Fixed, not per line. It used to call
// `computeRunningOnHand` for every line (about six reads each, one of them a
// recipe walk), then read the prior model state and upserted, line by line:
// ~500 round trips to finish a 76-line count. It now loads the store's
// inventory context once (`loadStoreInventoryContext` — the same six
// store-wide reads the count page uses for its estimates), reads the
// ingredients and prior model states in one query each, derives every line's
// on-hand with `runningOnHandFromContext` (the same arithmetic, no queries),
// and writes all the rows in one transaction: a `createMany` for the new
// ingredients and one `UPDATE ... FROM (VALUES ...)` for the existing ones.

import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import {
  loadStoreInventoryContext,
  runningOnHandFromContext,
  type ContextIngredient,
  type StoreInventoryContext,
} from "@/lib/inventory/store-inventory-context"
import {
  applyRecountUpdate,
  deriveConfidenceLevel,
  initialModelState,
  type ModelStateCore,
} from "@/lib/inventory/calibration"

const DAY_MS = 24 * 60 * 60 * 1000

/** One `IngredientModelState` row as this module writes it. */
export interface ModelStateWrite {
  storeId: string
  canonicalIngredientId: string
  calibrationFactor: number
  recountDeltaMean: number
  recountDeltaM2: number
  sampleSize: number
  consecutiveTightWeeks: number
  isGraduated: boolean
  graduatedAt: Date | null
  confidenceLevel: ReturnType<typeof deriveConfidenceLevel>
  typicalWeeklyThroughput: number
  lastUpdatedAt: Date
}

export interface CalibrationLine {
  canonicalIngredientId: string
  qtyInRecipeUnit: number
  estimatedQtyAtCount: number
}

/**
 * The rows to write for a closing count: pure, no queries. `priors` holds the
 * model state already on file, by ingredient; an ingredient not in
 * `ingredients` (deleted, or not this account's) is skipped, as it was when
 * `computeRunningOnHand` returned null for it.
 */
export function computeModelStateWrites(input: {
  storeId: string
  countedAt: Date
  lines: CalibrationLine[]
  ingredients: Map<string, ContextIngredient>
  ctx: StoreInventoryContext
  priors: Map<string, ModelStateCore>
}): ModelStateWrite[] {
  const { storeId, countedAt, ctx } = input
  const out: ModelStateWrite[] = []
  for (const line of input.lines) {
    const ingredient = input.ingredients.get(line.canonicalIngredientId)
    if (!ingredient) continue
    const onHand = runningOnHandFromContext(ctx, ingredient)

    const observedDepletion =
      onHand.baseQty + onHand.deliveriesQty - onHand.adjustmentsQty - line.qtyInRecipeUnit
    const periodDays = onHand.baseAt
      ? Math.max(1, (countedAt.getTime() - onHand.baseAt.getTime()) / DAY_MS)
      : 7
    const weeklyThroughput = (observedDepletion * 7) / periodDays
    const residual = line.estimatedQtyAtCount - line.qtyInRecipeUnit

    const prior = input.priors.get(line.canonicalIngredientId) ?? initialModelState()
    const next = applyRecountUpdate(prior, {
      theoreticalDepletion: onHand.depletionQty,
      observedDepletion,
      residual,
      weeklyThroughput,
      occurredAt: countedAt,
    })
    out.push({
      storeId,
      canonicalIngredientId: line.canonicalIngredientId,
      calibrationFactor: next.calibrationFactor,
      recountDeltaMean: next.recountDeltaMean,
      recountDeltaM2: next.recountDeltaM2,
      sampleSize: next.sampleSize,
      consecutiveTightWeeks: next.consecutiveTightWeeks,
      isGraduated: next.isGraduated,
      graduatedAt: next.graduatedAt,
      confidenceLevel: deriveConfidenceLevel(next),
      typicalWeeklyThroughput: weeklyThroughput,
      lastUpdatedAt: countedAt,
    })
  }
  return out
}

/**
 * `accountId` is the tenancy boundary: the count is read through its store,
 * and the ingredients and the store inventory context are the account's.
 */
/**
 * Applies the count's calibration. With `finish`, the status flip and the
 * calibration writes commit in ONE interactive transaction, flip first:
 * `finish` runs the guarded `IN_PROGRESS -> COMPLETED` update on the
 * transaction client and returns whether it changed the row. When it did
 * not (a second tap, a retry after a crash that already committed), nothing
 * is written. Before this the calibration committed on its own and the flip
 * followed separately, so a crash between the two, then a retry, applied the
 * same recount twice to every model state.
 *
 * Every READ still happens before the transaction opens, while the count is
 * IN_PROGRESS, so the anchor is the previous COMPLETED count exactly as
 * before: figures identical.
 *
 * Returns false only when `finish` reported the count already finished.
 */
export async function applyCalibrationUpdatesForCount(
  stockCountId: string,
  accountId: string,
  finish?: (tx: Prisma.TransactionClient) => Promise<boolean>,
): Promise<boolean> {
  const plan = await planCalibrationUpdates(stockCountId, accountId)
  if (!finish) {
    if (plan) await writePlanOutsideTransaction(plan)
    return true
  }
  return prisma.$transaction(async (tx) => {
    if (!(await finish(tx))) return false
    if (plan) await writePlan(tx, plan)
    return true
  })
}

type CalibrationPlan = {
  stockCountId: string
  storeId: string
  toUpdate: ModelStateWrite[]
  toCreate: ModelStateWrite[]
}

async function planCalibrationUpdates(
  stockCountId: string,
  accountId: string,
): Promise<CalibrationPlan | null> {
  const count = await prisma.stockCount.findFirst({
    where: { id: stockCountId, store: { accountId } },
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
  if (!count) return null

  const linesWithEstimate = count.lines.filter(
    (l): l is typeof l & { estimatedQtyAtCount: number } =>
      l.estimatedQtyAtCount !== null && Number.isFinite(l.estimatedQtyAtCount),
  )
  if (linesWithEstimate.length === 0) return null

  const ids = linesWithEstimate.map((l) => l.canonicalIngredientId)
  const [ctx, ingredientRows, priorRows] = await Promise.all([
    // `asOf` is the count's own moment, so the anchor is the count BEFORE it:
    // this one is still IN_PROGRESS and the context reads COMPLETED ones.
    loadStoreInventoryContext({ storeId: count.storeId, accountId, asOf: count.countedAt }),
    prisma.canonicalIngredient.findMany({
      where: { id: { in: ids }, accountId },
      select: {
        id: true,
        name: true,
        recipeUnit: true,
        // The pack is the CS -> recipe-unit factor. Without it every delivery on
        // a case-priced invoice is dropped; see `convertDelivered`.
        caseUnit: true,
        recipeUnitsPerCase: true,
        innerPackUnit: true,
        innerPacksPerCase: true,
      },
    }),
    prisma.ingredientModelState.findMany({
      where: { storeId: count.storeId, canonicalIngredientId: { in: ids } },
      select: {
        canonicalIngredientId: true,
        calibrationFactor: true,
        recountDeltaMean: true,
        recountDeltaM2: true,
        sampleSize: true,
        consecutiveTightWeeks: true,
        isGraduated: true,
        graduatedAt: true,
      },
    }),
  ])

  const writes = computeModelStateWrites({
    storeId: count.storeId,
    countedAt: count.countedAt,
    lines: linesWithEstimate,
    ingredients: new Map(ingredientRows.map((i) => [i.id, i])),
    ctx,
    priors: new Map(
      priorRows.map((r) => [
        r.canonicalIngredientId,
        {
          calibrationFactor: r.calibrationFactor,
          recountDeltaMean: r.recountDeltaMean,
          recountDeltaM2: r.recountDeltaM2,
          sampleSize: r.sampleSize,
          consecutiveTightWeeks: r.consecutiveTightWeeks,
          isGraduated: r.isGraduated,
          graduatedAt: r.graduatedAt,
        },
      ]),
    ),
  })
  if (writes.length === 0) return null

  const existing = new Set(priorRows.map((r) => r.canonicalIngredientId))
  const toCreate = writes.filter((w) => !existing.has(w.canonicalIngredientId))
  const toUpdate = writes.filter((w) => existing.has(w.canonicalIngredientId))

  return { stockCountId, storeId: count.storeId, toUpdate, toCreate }
}

/** One transaction, two statements at most, whatever the line count. */
async function writePlanOutsideTransaction(plan: CalibrationPlan): Promise<void> {
  const { storeId, toUpdate, toCreate } = plan
  const results = await prisma.$transaction([
    ...(toUpdate.length > 0 ? [updateModelStates(prisma, storeId, toUpdate)] : []),
    ...(toCreate.length > 0
      ? [prisma.ingredientModelState.createMany({ data: toCreate, skipDuplicates: true })]
      : []),
  ])
  warnShortUpdate(plan, toUpdate.length > 0 ? results[0] : undefined)
}

/** The same two statements, on a caller's transaction. */
async function writePlan(tx: Prisma.TransactionClient, plan: CalibrationPlan): Promise<void> {
  const { storeId, toUpdate, toCreate } = plan
  const updated = toUpdate.length > 0 ? await updateModelStates(tx, storeId, toUpdate) : undefined
  if (toCreate.length > 0) {
    await tx.ingredientModelState.createMany({ data: toCreate, skipDuplicates: true })
  }
  warnShortUpdate(plan, updated)
}

// A row deleted between the read and this write is skipped, not re-made;
// the next finished count creates it again. Say so rather than stay quiet.
function warnShortUpdate(plan: CalibrationPlan, updated: unknown): void {
  if (plan.toUpdate.length > 0 && updated !== plan.toUpdate.length) {
    console.warn(
      `[calibration] updated ${String(updated)} of ${plan.toUpdate.length} model states for count ${plan.stockCountId}`,
    )
  }
}

/** `UPDATE ... FROM (VALUES ...)`: every existing row in one statement. */
function updateModelStates(
  db: Pick<Prisma.TransactionClient, "$executeRaw">,
  storeId: string,
  rows: ModelStateWrite[],
) {
  const values = Prisma.join(
    rows.map(
      (r) =>
        Prisma.sql`(${r.canonicalIngredientId}::text, ${r.calibrationFactor}::float8, ${r.recountDeltaMean}::float8, ${r.recountDeltaM2}::float8, ${r.sampleSize}::int, ${r.consecutiveTightWeeks}::int, ${r.isGraduated}::boolean, ${r.graduatedAt}::timestamp, ${r.confidenceLevel}::text, ${r.typicalWeeklyThroughput}::float8, ${r.lastUpdatedAt}::timestamp)`,
    ),
  )
  return db.$executeRaw`
    UPDATE "IngredientModelState" AS m SET
      "calibrationFactor" = v.cf,
      "recountDeltaMean" = v.rdm,
      "recountDeltaM2" = v.rdm2,
      "sampleSize" = v.ss,
      "consecutiveTightWeeks" = v.ctw,
      "isGraduated" = v.ig,
      "graduatedAt" = v.ga,
      "confidenceLevel" = v.cl::"IngredientConfidenceLevel",
      "typicalWeeklyThroughput" = v.twt,
      "lastUpdatedAt" = v.lu
    FROM (VALUES ${values}) AS v(cid, cf, rdm, rdm2, ss, ctw, ig, ga, cl, twt, lu)
    WHERE m."storeId" = ${storeId} AND m."canonicalIngredientId" = v.cid`
}
