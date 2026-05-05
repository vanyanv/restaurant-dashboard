"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { resolveStoreScope } from "@/app/actions/_shared/auth-scope"
import type {
  RecipeWithIngredients,
  RecipeInput,
  MenuItemForRecipeBuilder,
} from "@/types/product-usage"

export async function getRecipes(
  storeId?: string
): Promise<RecipeWithIngredients[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []
  const scope = await resolveStoreScope(session, storeId)
  if (!scope || scope.storeIds.length === 0) return []

  const recipes = await prisma.recipe.findMany({
    where: { accountId: session.user.accountId },
    include: {
      ingredients: {
        select: {
          id: true,
          ingredientName: true,
          quantity: true,
          unit: true,
          notes: true,
        },
      },
    },
    orderBy: [{ category: "asc" }, { itemName: "asc" }],
  })

  return recipes.map((r) => ({
    id: r.id,
    itemName: r.itemName,
    category: r.category,
    servingSize: r.servingSize,
    notes: r.notes,
    foodCostOverride: r.foodCostOverride,
    isAiGenerated: r.isAiGenerated,
    isConfirmed: r.isConfirmed,
    ingredients: r.ingredients.map((ing) => ({
      id: ing.id,
      ingredientName: ing.ingredientName,
      quantity: ing.quantity,
      unit: ing.unit,
      notes: ing.notes,
    })),
  }))
}

export async function upsertRecipe(
  storeId: string,
  data: RecipeInput
): Promise<RecipeWithIngredients | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null

  // Verify ownership
  const store = await prisma.store.findFirst({
    where: { id: storeId, accountId: session.user.accountId },
  })
  if (!store) return null

  const result = await prisma.$transaction(async (tx) => {
    // Upsert the recipe (owner-level)
    const recipe = await tx.recipe.upsert({
      where: {
        accountId_itemName_category: {
          accountId: session.user.accountId,
          itemName: data.itemName,
          category: data.category,
        },
      },
      create: {
        ownerId: session.user.id,
        accountId: session.user.accountId,
        itemName: data.itemName,
        category: data.category,
        servingSize: data.servingSize ?? 1,
        notes: data.notes ?? null,
        foodCostOverride: data.foodCostOverride ?? null,
        isAiGenerated: false,
        isConfirmed: true,
      },
      update: {
        servingSize: data.servingSize ?? 1,
        notes: data.notes ?? null,
        foodCostOverride: data.foodCostOverride ?? null,
        isConfirmed: true,
        updatedAt: new Date(),
      },
    })

    // Delete old ingredients and recreate
    await tx.recipeIngredient.deleteMany({
      where: { recipeId: recipe.id },
    })

    if (data.ingredients.length > 0) {
      await tx.recipeIngredient.createMany({
        data: data.ingredients.map((ing) => ({
          recipeId: recipe.id,
          ingredientName: ing.ingredientName,
          quantity: ing.quantity,
          unit: ing.unit,
          notes: ing.notes ?? null,
        })),
      })
    }

    // Fetch the complete recipe with ingredients
    return tx.recipe.findUnique({
      where: { id: recipe.id },
      include: {
        ingredients: {
          select: {
            id: true,
            ingredientName: true,
            quantity: true,
            unit: true,
            notes: true,
          },
        },
      },
    })
  })

  if (!result) return null

  return {
    id: result.id,
    itemName: result.itemName,
    category: result.category,
    servingSize: result.servingSize,
    notes: result.notes,
    foodCostOverride: result.foodCostOverride,
    isAiGenerated: result.isAiGenerated,
    isConfirmed: result.isConfirmed,
    ingredients: result.ingredients.map((ing) => ({
      id: ing.id,
      ingredientName: ing.ingredientName,
      quantity: ing.quantity,
      unit: ing.unit,
      notes: ing.notes,
    })),
  }
}

export async function deleteRecipe(recipeId: string): Promise<boolean> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return false

  // Owner-level check
  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, accountId: session.user.accountId },
    select: { id: true },
  })
  if (!recipe) return false

  await prisma.recipe.delete({ where: { id: recipeId } })
  return true
}

export async function getMenuItemsForRecipeBuilder(
  storeId?: string
): Promise<MenuItemForRecipeBuilder[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []
  const scope = await resolveStoreScope(session, storeId)
  if (!scope || scope.storeIds.length === 0) return []
  const { targetStoreIds } = scope

  // Last 30 days
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - 30)

  const [menuItems, recipes] = await Promise.all([
    prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: targetStoreIds },
        date: { gte: sinceDate },
      },
      select: {
        itemName: true,
        category: true,
        fpQuantitySold: true,
        tpQuantitySold: true,
      },
    }),
    prisma.recipe.findMany({
      where: { accountId: session.user.accountId },
      select: { itemName: true, category: true },
    }),
  ])

  // Build recipe set for lookup
  const recipeSet = new Set<string>()
  for (const r of recipes) {
    recipeSet.add(`${r.itemName}:::${r.category}`)
  }

  // Aggregate menu items by (itemName, category)
  const menuMap = new Map<
    string,
    { itemName: string; category: string; totalQtySold: number }
  >()
  for (const mi of menuItems) {
    const key = `${mi.itemName}:::${mi.category}`
    const existing = menuMap.get(key)
    const qtySold = mi.fpQuantitySold + mi.tpQuantitySold
    if (existing) {
      existing.totalQtySold += qtySold
    } else {
      menuMap.set(key, {
        itemName: mi.itemName,
        category: mi.category,
        totalQtySold: qtySold,
      })
    }
  }

  return Array.from(menuMap.values())
    .map((item) => ({
      itemName: item.itemName,
      category: item.category,
      hasRecipe: recipeSet.has(`${item.itemName}:::${item.category}`),
      totalQuantitySold: item.totalQtySold,
    }))
    .sort((a, b) => b.totalQuantitySold - a.totalQuantitySold)
}
