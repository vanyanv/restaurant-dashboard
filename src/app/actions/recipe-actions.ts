"use server"

import { getAuthScope as requireScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import {
  assertNoCycles,
  previewRecipeCost as computeDraftCost,
  type RecipeCostResult,
} from "@/lib/recipe-cost"
import { assertYieldUnitChangeSafe, validateRecipeShape } from "@/lib/recipe-validation"
import { costRecipeCached } from "@/lib/cached"
import { batchRecipeCosts } from "@/lib/recipe-cost-batch"
import { revalidatePath } from "next/cache"
import type { RecipeInput, RecipeSummary } from "@/types/recipe"
import {
  getMenuItemSellPrices,
  getMenuItemsForCatalog,
} from "@/app/actions/menu-item-actions"
import { resolveSellPriceForRecipe } from "@/lib/menu-sell-price"

export async function listRecipes(): Promise<RecipeSummary[]> {
  const scope = await requireScope()
  if (!scope) return []
  const { accountId } = scope

  const recipes = await prisma.recipe.findMany({
    where: { accountId, category: { not: "Uncategorized" } },
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

  const costs = await batchRecipeCosts(accountId)

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
  const scope = await requireScope()
  if (!scope) return null
  const { ownerId, accountId } = scope
  void ownerId
  if (!ownerId) return null

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, accountId },
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
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { ownerId, accountId } = scope

  const { id } = await prisma.$transaction(async (tx) => {
    if (input.id) {
      // Scope the update by accountId — a bare update({ where: { id } })
      // would let any authenticated user overwrite another account's recipe.
      // FIRST, before any other check: a caller poking at somebody else's
      // recipe id must get "not found" and learn nothing else, so the shape
      // of their payload can never change the answer.
      const existing = await tx.recipe.findFirst({
        where: { id: input.id, accountId },
        select: { id: true },
      })
      if (!existing) throw new Error("Recipe not found")
    }

    // Inside the transaction and against `tx`, so the checks see the same
    // state the writes below will land on, and a failure rolls everything
    // back rather than leaving a half-saved recipe. This is also where a
    // reference to another account's ingredient or sub-recipe is refused —
    // scoping the recipe row by accountId never covered what it points at.
    await validateRecipeShape(input, accountId, tx)

    // And the recipes that draw on THIS one, which `validateRecipeShape` has
    // no way to see. A yield unit is a contract with every parent line, so
    // changing it can break a recipe nobody touched.
    if (input.id) {
      await assertYieldUnitChangeSafe(input.id, normalizeYieldUnit(input.yieldUnit), accountId, tx)
    }

    const recipe = input.id
      ? await tx.recipe.update({
          where: { id: input.id },
          data: {
            itemName: input.itemName.trim(),
            category: input.category,
            servingSize: input.servingSize,
            yieldUnit: normalizeYieldUnit(input.yieldUnit),
            isSellable: input.isSellable,
            notes: input.notes ?? null,
            foodCostOverride: input.foodCostOverride ?? null,
          },
        })
      : await tx.recipe.create({
          data: {
            ownerId,
            accountId,
            itemName: input.itemName.trim(),
            category: input.category,
            servingSize: input.servingSize,
            yieldUnit: normalizeYieldUnit(input.yieldUnit),
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

    // Cycle check inside the transaction (reading uncommitted writes via tx):
    // a RecipeCycleError aborts the whole save, so an update rolls back to
    // the prior version instead of being deleted by a post-commit
    // compensation, and a create leaves nothing behind.
    await assertNoCycles(recipe.id, tx)

    return { id: recipe.id }
  })

  revalidatePath("/dashboard/recipes")
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/ingredients")

  return { id }
}

/**
 * Empty string and whitespace both mean "this recipe yields portions", which
 * is `null` in the column. A `""` stored there would canonicalize to nothing
 * and make every line drawing on the recipe unresolvable.
 */
function normalizeYieldUnit(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { ownerId, accountId } = scope

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, accountId },
    select: { id: true, itemName: true },
  })
  if (!recipe) throw new Error("Recipe not found")

  const referenced = await prisma.recipeIngredient.findFirst({
    where: { componentRecipeId: recipeId, recipe: { accountId } },
    select: { recipe: { select: { itemName: true } } },
  })
  if (referenced) {
    throw new Error(
      `Cannot delete: “${referenced.recipe.itemName}” uses this recipe as a sub-recipe.`
    )
  }

  await prisma.recipe.delete({ where: { id: recipeId } })

  revalidatePath("/dashboard/recipes")
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/ingredients")
}

/**
 * Cost a recipe the owner is still typing, so the figure under their cursor is
 * the figure they will get after Save.
 *
 * This used to be a fourth hand-written copy of the cost walk — it did not
 * apply the override fallback, did not flag the price-spike guard, multiplied
 * a sub-recipe line by its quantity without reading the unit, and had no
 * tenancy check on the ids it was handed. It is now a scope check in front of
 * `previewRecipeCost` in `@/lib/recipe-cost`, which builds the draft into the
 * one walk.
 *
 * It was also dead: nothing in the product called it, which is why the
 * editor's cost panel never moved until you saved.
 */
export async function previewRecipeCost(input: {
  servingSize?: number
  yieldUnit?: string | null
  foodCostOverride?: number | null
  ingredients: Array<{
    canonicalIngredientId?: string | null
    componentRecipeId?: string | null
    quantity: number
    unit: string
    ingredientName?: string | null
  }>
}): Promise<RecipeCostResult> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { accountId } = scope

  // The draft is unsaved, so nothing has scoped its references yet. Price only
  // what this account owns; anything else is dropped rather than costed, which
  // shows up as a missing line instead of leaking another account's prices.
  const canonicalIds = [
    ...new Set(input.ingredients.map((l) => l.canonicalIngredientId).filter((v): v is string => !!v)),
  ]
  const componentIds = [
    ...new Set(input.ingredients.map((l) => l.componentRecipeId).filter((v): v is string => !!v)),
  ]
  const [ownCanonicals, ownComponents] = await Promise.all([
    canonicalIds.length > 0
      ? prisma.canonicalIngredient.findMany({
          where: { id: { in: canonicalIds }, accountId },
          select: { id: true },
        })
      : Promise.resolve([]),
    componentIds.length > 0
      ? prisma.recipe.findMany({
          where: { id: { in: componentIds }, accountId },
          select: { id: true },
        })
      : Promise.resolve([]),
  ])
  const okCanonical = new Set(ownCanonicals.map((c) => c.id))
  const okComponent = new Set(ownComponents.map((r) => r.id))

  return computeDraftCost({
    servingSize: input.servingSize,
    yieldUnit: input.yieldUnit,
    foodCostOverride: input.foodCostOverride,
    ingredients: input.ingredients.map((ing) => ({
      ...ing,
      canonicalIngredientId:
        ing.canonicalIngredientId && okCanonical.has(ing.canonicalIngredientId)
          ? ing.canonicalIngredientId
          : null,
      componentRecipeId:
        ing.componentRecipeId && okComponent.has(ing.componentRecipeId)
          ? ing.componentRecipeId
          : null,
    })),
  })
}

export async function confirmRecipe(
  recipeId: string,
  confirmed: boolean
): Promise<void> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { ownerId, accountId } = scope
  const updated = await prisma.recipe.updateMany({
    where: { id: recipeId, accountId },
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
  const scope = await requireScope()
  if (!scope) return null
  const { ownerId, accountId } = scope
  void ownerId
  if (!ownerId) return null

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, accountId },
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
