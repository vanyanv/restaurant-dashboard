"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  computeRecipeCost,
  computeIngredientLineCost,
  assertNoCycles,
  RecipeCycleError,
  type RecipeCostLine,
  type RecipeCostResult,
} from "@/lib/recipe-cost"
import { costRecipeCached, costIngredientCached } from "@/lib/cached"
import { batchRecipeCosts } from "@/lib/recipe-cost-batch"
import { revalidatePath } from "next/cache"
import type { RecipeInput, RecipeSummary } from "@/types/recipe"
import {
  getMenuItemSellPrices,
  getMenuItemsForCatalog,
} from "@/app/actions/menu-item-actions"
import { resolveSellPriceForRecipe } from "@/lib/menu-sell-price"

async function requireOwnerId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id ?? null
}

function validateIngredients(input: RecipeInput): void {
  for (const [i, ing] of input.ingredients.entries()) {
    const hasCanonical = !!ing.canonicalIngredientId
    const hasComponent = !!ing.componentRecipeId
    if (hasCanonical === hasComponent) {
      throw new Error(
        `Ingredient row ${i + 1}: exactly one of canonicalIngredientId or componentRecipeId is required`
      )
    }
    if (ing.quantity <= 0) {
      throw new Error(`Ingredient row ${i + 1}: quantity must be > 0`)
    }
    if (!ing.unit?.trim()) {
      throw new Error(`Ingredient row ${i + 1}: unit is required`)
    }
  }
}

export async function listRecipes(): Promise<RecipeSummary[]> {
  const ownerId = await requireOwnerId()
  if (!ownerId) return []

  const recipes = await prisma.recipe.findMany({
    where: { ownerId, category: { not: "Uncategorized" } },
    orderBy: [{ isSellable: "desc" }, { itemName: "asc" }],
    select: {
      id: true,
      itemName: true,
      category: true,
      isSellable: true,
      isConfirmed: true,
      updatedAt: true,
      ingredients: { select: { id: true } },
    },
  })

  const costs = await batchRecipeCosts(ownerId)

  return recipes.map((r) => {
    const cost = costs.get(r.id)
    return {
      id: r.id,
      itemName: r.itemName,
      category: r.category,
      isSellable: r.isSellable,
      isConfirmed: r.isConfirmed,
      ingredientCount: r.ingredients.length,
      computedCost: cost?.totalCost ?? null,
      partialCost: cost?.partial ?? true,
      updatedAt: r.updatedAt,
    }
  })
}

export async function getRecipeDetail(recipeId: string) {
  const ownerId = await requireOwnerId()
  if (!ownerId) return null

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, ownerId },
    include: {
      ingredients: {
        include: {
          canonicalIngredient: true,
          componentRecipe: {
            select: { id: true, itemName: true, category: true },
          },
        },
      },
    },
  })
  if (!recipe) return null

  const cost = await costRecipeCached(recipeId).catch(() => null)
  return { recipe, cost }
}

export async function upsertRecipe(
  input: RecipeInput
): Promise<{ id: string }> {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")
  validateIngredients(input)

  const { id } = await prisma.$transaction(async (tx) => {
    const recipe = input.id
      ? await tx.recipe.update({
          where: { id: input.id },
          data: {
            itemName: input.itemName.trim(),
            category: input.category,
            servingSize: input.servingSize,
            isSellable: input.isSellable,
            notes: input.notes ?? null,
            foodCostOverride: input.foodCostOverride ?? null,
          },
        })
      : await tx.recipe.create({
          data: {
            ownerId,
            itemName: input.itemName.trim(),
            category: input.category,
            servingSize: input.servingSize,
            isSellable: input.isSellable,
            notes: input.notes ?? null,
            foodCostOverride: input.foodCostOverride ?? null,
          },
        })

    await tx.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } })
    if (input.ingredients.length > 0) {
      await tx.recipeIngredient.createMany({
        data: input.ingredients.map((ing) => ({
          recipeId: recipe.id,
          canonicalIngredientId: ing.canonicalIngredientId ?? null,
          componentRecipeId: ing.componentRecipeId ?? null,
          ingredientName: ing.ingredientName ?? null,
          quantity: ing.quantity,
          unit: ing.unit,
          notes: ing.notes ?? null,
        })),
      })
    }

    return { id: recipe.id }
  })

  try {
    await assertNoCycles(id)
  } catch (err) {
    if (err instanceof RecipeCycleError) {
      await prisma.recipe.delete({ where: { id } }).catch(() => null)
      throw err
    }
    throw err
  }

  revalidatePath("/dashboard/recipes")
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/ingredients")

  return { id }
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, ownerId },
    select: { id: true, itemName: true },
  })
  if (!recipe) throw new Error("Recipe not found")

  const referenced = await prisma.recipeIngredient.findFirst({
    where: { componentRecipeId: recipeId },
    select: { recipeId: true },
  })
  if (referenced) {
    throw new Error(
      "Cannot delete: this recipe is used as a sub-recipe elsewhere"
    )
  }

  await prisma.recipe.delete({ where: { id: recipeId } })

  revalidatePath("/dashboard/recipes")
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/ingredients")
}

/**
 * Compute the live cost of an in-flight (unsaved) recipe. Used by the editor
 * preview panel so the user sees cost updates as they edit.
 */
export async function previewRecipeCost(input: {
  ingredients: Array<{
    canonicalIngredientId?: string | null
    componentRecipeId?: string | null
    quantity: number
    unit: string
    ingredientName?: string | null
  }>
}): Promise<RecipeCostResult> {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")

  const lines: RecipeCostLine[] = []
  let total = 0
  let partial = false

  for (const ing of input.ingredients) {
    if (ing.componentRecipeId) {
      const sub = await computeRecipeCost(ing.componentRecipeId).catch(() => null)
      if (!sub) {
        partial = true
        lines.push({
          kind: "component",
          refId: ing.componentRecipeId,
          name: ing.ingredientName ?? "sub-recipe",
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: null,
          lineCost: 0,
          missingCost: true,
        })
        continue
      }
      const lineCost = sub.totalCost * ing.quantity
      total += lineCost
      if (sub.partial) partial = true
      lines.push({
        kind: "component",
        refId: ing.componentRecipeId,
        name: sub.itemName,
        quantity: ing.quantity,
        unit: ing.unit,
        unitCost: sub.totalCost,
        lineCost,
        missingCost: sub.partial,
      })
      continue
    }
    if (ing.canonicalIngredientId) {
      const cost = await costIngredientCached(ing.canonicalIngredientId)
      if (!cost) {
        partial = true
        lines.push({
          kind: "ingredient",
          refId: ing.canonicalIngredientId,
          name: ing.ingredientName ?? "ingredient",
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: null,
          lineCost: 0,
          missingCost: true,
        })
        continue
      }
      const { lineCost, qtyInCostUnit } = computeIngredientLineCost({
        ingredientQuantity: ing.quantity,
        ingredientUnit: ing.unit,
        costUnitCost: cost.unitCost,
        costUnit: cost.unit,
      })
      if (qtyInCostUnit == null) {
        partial = true
        lines.push({
          kind: "ingredient",
          refId: ing.canonicalIngredientId,
          name: ing.ingredientName ?? "ingredient",
          quantity: ing.quantity,
          unit: ing.unit,
          unitCost: cost.unitCost,
          costUnit: cost.unit,
          lineCost: 0,
          missingCost: true,
          sourceInvoiceId: cost.sourceInvoiceId,
          sourceLineItemId: cost.sourceLineItemId,
          sourceVendor: cost.sourceVendor,
          sourceSku: cost.sourceSku,
          sourceInvoiceDate: cost.asOfDate,
        })
        continue
      }
      total += lineCost
      lines.push({
        kind: "ingredient",
        refId: ing.canonicalIngredientId,
        name: ing.ingredientName ?? "ingredient",
        quantity: ing.quantity,
        unit: ing.unit,
        unitCost: cost.unitCost,
        costUnit: cost.unit,
        lineCost,
        missingCost: false,
        sourceInvoiceId: cost.sourceInvoiceId,
        sourceLineItemId: cost.sourceLineItemId,
        sourceVendor: cost.sourceVendor,
        sourceSku: cost.sourceSku,
        sourceInvoiceDate: cost.asOfDate,
      })
    }
  }

  return {
    recipeId: "",
    itemName: "",
    totalCost: total,
    lines,
    partial,
  }
}

export async function confirmRecipe(
  recipeId: string,
  confirmed: boolean
): Promise<void> {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")
  const updated = await prisma.recipe.updateMany({
    where: { id: recipeId, ownerId },
    data: { isConfirmed: confirmed },
  })
  if (updated.count === 0) return
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: { itemName: true },
  })
  void recipe
  revalidatePath("/dashboard/recipes")
  revalidatePath("/dashboard/menu/catalog")
}

export type RecipeCatalogSummary = {
  id: string
  itemName: string
  category: string
  isConfirmed: boolean
  ingredientCount: number
  computedCost: number | null
  partialCost: boolean
  updatedAt: Date
  sellPrice: number | null
  qtySold: number
  sellSourceName: string | null
}

export async function getRecipeCatalogSummary(
  recipeId: string
): Promise<RecipeCatalogSummary | null> {
  const ownerId = await requireOwnerId()
  if (!ownerId) return null

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, ownerId },
    select: {
      id: true,
      itemName: true,
      category: true,
      isConfirmed: true,
      updatedAt: true,
      ingredients: { select: { id: true } },
    },
  })
  if (!recipe) return null

  const [cost, sellPrices, otterMappings] = await Promise.all([
    costRecipeCached(recipe.id).catch(() => null),
    getMenuItemSellPrices(30),
    getMenuItemsForCatalog(),
  ])

  const resolved = resolveSellPriceForRecipe(
    recipe.id,
    recipe.itemName,
    sellPrices,
    otterMappings
  )

  return {
    id: recipe.id,
    itemName: recipe.itemName,
    category: recipe.category,
    isConfirmed: recipe.isConfirmed,
    ingredientCount: recipe.ingredients.length,
    computedCost: cost?.totalCost ?? null,
    partialCost: cost?.partial ?? true,
    updatedAt: recipe.updatedAt,
    sellPrice: resolved?.avgPrice ?? null,
    qtySold: resolved?.qtySold ?? 0,
    sellSourceName: resolved?.sourceOtterName ?? null,
  }
}
