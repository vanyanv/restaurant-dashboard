"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { invalidateDailyCogs } from "@/lib/cogs-invalidate"
import type { MenuItemForCatalog } from "@/types/recipe"

async function requireOwnerId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id ?? null
}

/**
 * All distinct Otter-sold items across the owner's stores, with:
 *   - aggregate all-time units sold
 *   - first/last seen
 *   - whether it's already mapped to a Recipe (via OtterItemMapping or name match)
 *
 * Sorted by total qty sold DESC so the most-impactful items surface first.
 */
export async function getMenuItemsForCatalog(): Promise<MenuItemForCatalog[]> {
  const ownerId = await requireOwnerId()
  if (!ownerId) return []

  const stores = await prisma.store.findMany({
    where: { ownerId },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return []

  const menuRows = await prisma.otterMenuItem.findMany({
    where: { storeId: { in: storeIds }, isModifier: false },
    select: {
      storeId: true,
      itemName: true,
      category: true,
      date: true,
      fpQuantitySold: true,
      tpQuantitySold: true,
    },
  })

  // Aggregate by (itemName, category) across stores.
  type Agg = {
    totalQty: number
    firstSeen: Date
    lastSeen: Date
    storeIds: Set<string>
  }
  const agg = new Map<string, Agg>()
  for (const row of menuRows) {
    const key = `${row.itemName}:::${row.category}`
    const qty = (row.fpQuantitySold ?? 0) + (row.tpQuantitySold ?? 0)
    const existing = agg.get(key)
    if (existing) {
      existing.totalQty += qty
      if (row.date < existing.firstSeen) existing.firstSeen = row.date
      if (row.date > existing.lastSeen) existing.lastSeen = row.date
      existing.storeIds.add(row.storeId)
    } else {
      agg.set(key, {
        totalQty: qty,
        firstSeen: row.date,
        lastSeen: row.date,
        storeIds: new Set([row.storeId]),
      })
    }
  }

  const mappings = await prisma.otterItemMapping.findMany({
    where: { storeId: { in: storeIds } },
    include: { recipe: { select: { id: true, itemName: true } } },
  })
  const mappingByItemName = new Map<
    string,
    { recipeId: string; recipeName: string }
  >()
  for (const m of mappings) {
    if (!mappingByItemName.has(m.otterItemName)) {
      mappingByItemName.set(m.otterItemName, {
        recipeId: m.recipeId,
        recipeName: m.recipe.itemName,
      })
    }
  }

  const recipes = await prisma.recipe.findMany({
    where: { ownerId },
    select: { id: true, itemName: true },
  })
  const recipeByName = new Map(
    recipes.map((r) => [r.itemName.toLowerCase(), r])
  )

  const rows: MenuItemForCatalog[] = []
  for (const [key, data] of agg) {
    const [itemName, category] = key.split(":::")
    const explicitMapping = mappingByItemName.get(itemName)
    const fallbackRecipe = explicitMapping
      ? null
      : recipeByName.get(itemName.toLowerCase()) ?? null
    rows.push({
      otterItemName: itemName,
      category,
      totalQtySoldAllTime: data.totalQty,
      firstSeen: data.firstSeen,
      lastSeen: data.lastSeen,
      mappedRecipeId:
        explicitMapping?.recipeId ?? fallbackRecipe?.id ?? null,
      mappedRecipeName:
        explicitMapping?.recipeName ?? fallbackRecipe?.itemName ?? null,
      storeIds: Array.from(data.storeIds),
    })
  }

  rows.sort((a, b) => b.totalQtySoldAllTime - a.totalQtySoldAllTime)
  return rows
}

export async function mapOtterItemToRecipe(input: {
  otterItemName: string
  recipeId: string
}): Promise<void> {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")

  const stores = await prisma.store.findMany({
    where: { ownerId },
    select: { id: true },
  })
  const recipe = await prisma.recipe.findFirst({
    where: { id: input.recipeId, ownerId },
    select: { id: true },
  })
  if (!recipe) throw new Error("Recipe not found")

  await prisma.$transaction(
    stores.map((s) =>
      prisma.otterItemMapping.upsert({
        where: {
          storeId_otterItemName: {
            storeId: s.id,
            otterItemName: input.otterItemName,
          },
        },
        create: {
          storeId: s.id,
          otterItemName: input.otterItemName,
          recipeId: input.recipeId,
        },
        update: { recipeId: input.recipeId, confirmedAt: new Date() },
      })
    )
  )

  await Promise.all(
    stores.map((s) =>
      invalidateDailyCogs({
        kind: "store-item",
        storeId: s.id,
        itemName: input.otterItemName,
      })
    )
  )
}

export async function unmapOtterItem(otterItemName: string): Promise<void> {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")

  const stores = await prisma.store.findMany({
    where: { ownerId },
    select: { id: true },
  })
  await prisma.otterItemMapping.deleteMany({
    where: {
      otterItemName,
      storeId: { in: stores.map((s) => s.id) },
    },
  })

  await Promise.all(
    stores.map((s) =>
      invalidateDailyCogs({
        kind: "store-item",
        storeId: s.id,
        itemName: otterItemName,
      })
    )
  )
}
