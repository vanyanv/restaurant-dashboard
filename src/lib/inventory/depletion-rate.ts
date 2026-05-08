import { prisma } from "@/lib/prisma"
import { walkRecipeForIngredient } from "./recipe-walk"

const DEFAULT_LOOKBACK_DAYS = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface DailyDepletionRateResult {
  asOf: Date
  storeId: string
  ingredientId: string
  windowStart: Date
  windowDays: number
  depletionQty: number
  ratePerDay: number
}

/**
 * Trailing-average daily depletion in `recipeUnit / day`.
 *
 * Window selection: max(asOf - lookbackDays, lastCount.countedAt). If the most
 * recent COMPLETED count is *inside* the lookback window, the rate is computed
 * only against the post-count interval — pre-count days would be measured
 * against an estimate, not a known anchor, and would smear the signal.
 *
 * Window length is clamped to ≥ 1 day to avoid divide-by-zero on same-day calls.
 */
export async function computeDailyDepletionRate(input: {
  storeId: string
  ingredientId: string
  asOf?: Date
  lookbackDays?: number
}): Promise<DailyDepletionRateResult | null> {
  const asOf = input.asOf ?? new Date()
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS

  const ingredient = await prisma.canonicalIngredient.findUnique({
    where: { id: input.ingredientId },
    select: { id: true, recipeUnit: true },
  })
  if (!ingredient) return null
  const recipeUnit = ingredient.recipeUnit ?? ""

  const lastCount = await prisma.stockCountLine.findFirst({
    where: {
      canonicalIngredientId: input.ingredientId,
      stockCount: {
        storeId: input.storeId,
        status: "COMPLETED",
        countedAt: { lte: asOf },
      },
    },
    orderBy: { stockCount: { countedAt: "desc" } },
    select: { stockCount: { select: { countedAt: true } } },
  })

  const lookbackStart = new Date(asOf.getTime() - lookbackDays * MS_PER_DAY)
  const countAt = lastCount?.stockCount?.countedAt ?? null
  const windowStart =
    countAt && countAt.getTime() > lookbackStart.getTime() ? countAt : lookbackStart

  const rawDays = (asOf.getTime() - windowStart.getTime()) / MS_PER_DAY
  const windowDays = Math.max(1, Math.round(rawDays))

  const sales = await prisma.otterMenuItem.findMany({
    where: {
      storeId: input.storeId,
      date: { gt: windowStart, lte: asOf },
    },
    select: { itemName: true, fpQuantitySold: true, tpQuantitySold: true },
  })
  const mappings = await prisma.otterItemMapping.findMany({
    where: { storeId: input.storeId },
    select: { otterItemName: true, recipeId: true },
  })
  const recipeByItemName = new Map(mappings.map((m) => [m.otterItemName, m.recipeId]))

  const perServingByRecipe = new Map<string, number>()
  let depletionQty = 0
  for (const s of sales) {
    const recipeId = recipeByItemName.get(s.itemName)
    if (!recipeId) continue
    let perServing = perServingByRecipe.get(recipeId)
    if (perServing === undefined) {
      perServing = await walkRecipeForIngredient(recipeId, input.ingredientId, recipeUnit)
      perServingByRecipe.set(recipeId, perServing)
    }
    const sold = (s.fpQuantitySold ?? 0) + (s.tpQuantitySold ?? 0)
    depletionQty += perServing * sold
  }

  return {
    asOf,
    storeId: input.storeId,
    ingredientId: input.ingredientId,
    windowStart,
    windowDays,
    depletionQty,
    ratePerDay: depletionQty / windowDays,
  }
}
