import { prisma } from "@/lib/prisma"
import { canonicalizeUnit, convert } from "@/lib/unit-conversion"
import { walkRecipeForIngredient } from "./recipe-walk"

export interface RunningOnHandResult {
  asOf: Date
  storeId: string
  ingredientId: string
  ingredientName: string
  recipeUnit: string
  /** Quantity from the most recent COMPLETED count for this (store, ingredient). */
  baseQty: number
  /** When the anchoring count was taken; null if no count exists yet. */
  baseAt: Date | null
  /** Σ invoice deliveries since baseAt (or all-time when baseAt is null), in recipeUnit. */
  deliveriesQty: number
  /** Σ theoretical depletion since baseAt, in recipeUnit. */
  depletionQty: number
  /** Σ inventory adjustments since baseAt, in recipeUnit. Always subtracted. */
  adjustmentsQty: number
  /** baseQty + deliveries − depletion − adjustments. */
  onHand: number
  /** True when at least one invoice line had an un-convertible unit. */
  partial: boolean
}

export async function computeRunningOnHand(input: {
  storeId: string
  ingredientId: string
  asOf?: Date
}): Promise<RunningOnHandResult | null> {
  const asOf = input.asOf ?? new Date()

  const ingredient = await prisma.canonicalIngredient.findUnique({
    where: { id: input.ingredientId },
    select: { id: true, name: true, recipeUnit: true },
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
    select: {
      qtyInRecipeUnit: true,
      stockCount: { select: { countedAt: true } },
    },
  })
  const baseQty = lastCount?.qtyInRecipeUnit ?? 0
  const baseAt: Date | null = lastCount?.stockCount?.countedAt ?? null

  const sinceFilter = baseAt ?? new Date(0)

  const deliveryLines = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId: input.ingredientId,
      invoice: {
        storeId: input.storeId,
        invoiceDate: { gte: sinceFilter, lte: asOf },
      },
    },
    select: { quantity: true, unit: true },
  })

  let deliveriesQty = 0
  let partial = false
  for (const line of deliveryLines) {
    const qty = convertQty(line.quantity, line.unit ?? recipeUnit, recipeUnit)
    if (qty == null) {
      partial = true
      continue
    }
    deliveriesQty += qty
  }

  const sales = await prisma.otterMenuItem.findMany({
    where: {
      storeId: input.storeId,
      date: { gt: sinceFilter, lte: asOf },
    },
    select: {
      itemName: true,
      fpQuantitySold: true,
      tpQuantitySold: true,
    },
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

  const adjustments = await prisma.inventoryAdjustment.findMany({
    where: {
      storeId: input.storeId,
      canonicalIngredientId: input.ingredientId,
      occurredAt: { gt: sinceFilter, lte: asOf },
    },
    select: { qty: true },
  })
  const adjustmentsQty = adjustments.reduce((sum, a) => sum + a.qty, 0)

  const onHand = baseQty + deliveriesQty - depletionQty - adjustmentsQty

  return {
    asOf,
    storeId: input.storeId,
    ingredientId: input.ingredientId,
    ingredientName: ingredient.name,
    recipeUnit,
    baseQty,
    baseAt,
    deliveriesQty,
    depletionQty,
    adjustmentsQty,
    onHand,
    partial,
  }
}

function convertQty(qty: number, fromUnit: string, toUnit: string): number | null {
  const a = canonicalizeUnit(fromUnit)
  const b = canonicalizeUnit(toUnit)
  if (a && b && a === b) return qty
  if (a && b) return convert(qty, fromUnit, toUnit)
  return fromUnit.trim().toLowerCase() === toUnit.trim().toLowerCase() ? qty : null
}
