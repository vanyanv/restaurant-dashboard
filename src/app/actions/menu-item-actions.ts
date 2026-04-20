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
    where: {
      storeId: { in: storeIds },
      isModifier: false,
      category: { not: "Uncategorized" },
    },
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

/* ─────────────────────────────── sub-items (modifiers) ─────────────────────────────── */

export type OtterSubItemForCatalog = {
  skuId: string
  /** Most common display name for this SKU. */
  name: string
  /** Parent sub-header (e.g. "Add Toppings (Meat & Cheese Base)") — most common seen. */
  subHeader: string | null
  occurrences: number
  firstSeen: Date | null
  lastSeen: Date | null
  storeIds: string[]
  mappedRecipeId: string | null
  mappedRecipeName: string | null
}

/**
 * Aggregate every Otter order sub-item the owner has seen, grouped by skuId,
 * with occurrence counts and mapping status. Sorted by occurrences DESC so
 * high-impact modifiers surface first.
 *
 * Every OtterOrderSubItem carries a stable skuId (verified: 0 nulls in DB),
 * and names are 1:1 with skuIds, so skuId is the sole identity. Multiple
 * skuIds that happen to mean the same thing (e.g. "Add Pickle" vs
 * "Add Pickles" on different menu platforms) can each map to the same
 * modifier recipe.
 */
export async function getOtterSubItemsForCatalog(): Promise<OtterSubItemForCatalog[]> {
  const ownerId = await requireOwnerId()
  if (!ownerId) return []

  const stores = await prisma.store.findMany({
    where: { ownerId },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return []

  const subs = await prisma.otterOrderSubItem.findMany({
    where: {
      orderItem: { order: { storeId: { in: storeIds } } },
    },
    select: {
      skuId: true,
      name: true,
      subHeader: true,
      quantity: true,
      orderItem: {
        select: {
          quantity: true,
          order: {
            select: { storeId: true, referenceTimeLocal: true },
          },
        },
      },
    },
  })

  type Agg = {
    skuId: string
    nameCounts: Map<string, number>
    subHeaderCounts: Map<string, number>
    occurrences: number
    firstSeen: Date | null
    lastSeen: Date | null
    storeIds: Set<string>
  }
  const bag = new Map<string, Agg>()
  for (const s of subs) {
    if (!s.skuId) continue
    let a = bag.get(s.skuId)
    if (!a) {
      a = {
        skuId: s.skuId,
        nameCounts: new Map(),
        subHeaderCounts: new Map(),
        occurrences: 0,
        firstSeen: null,
        lastSeen: null,
        storeIds: new Set(),
      }
      bag.set(s.skuId, a)
    }
    // Each row counts its own (subQty × parentItemQty) so we bias toward
    // how many physical modifier-uses actually happened.
    const uses = (s.quantity ?? 1) * (s.orderItem.quantity ?? 1)
    a.occurrences += uses
    a.nameCounts.set(s.name, (a.nameCounts.get(s.name) ?? 0) + uses)
    const sh = s.subHeader ?? "__none__"
    a.subHeaderCounts.set(sh, (a.subHeaderCounts.get(sh) ?? 0) + uses)
    a.storeIds.add(s.orderItem.order.storeId)
    const ts = s.orderItem.order.referenceTimeLocal
    if (ts) {
      if (!a.firstSeen || ts < a.firstSeen) a.firstSeen = ts
      if (!a.lastSeen || ts > a.lastSeen) a.lastSeen = ts
    }
  }

  const mappings = await prisma.otterSubItemMapping.findMany({
    where: { storeId: { in: storeIds } },
    include: { recipe: { select: { id: true, itemName: true } } },
  })
  const mappingBySku = new Map<
    string,
    { recipeId: string; recipeName: string }
  >()
  for (const m of mappings) {
    if (!mappingBySku.has(m.skuId)) {
      mappingBySku.set(m.skuId, {
        recipeId: m.recipeId,
        recipeName: m.recipe.itemName,
      })
    }
  }

  const rows: OtterSubItemForCatalog[] = []
  for (const a of bag.values()) {
    const mostCommonName = pickTopKey(a.nameCounts) ?? ""
    const mostCommonHeader = pickTopKey(a.subHeaderCounts)
    const m = mappingBySku.get(a.skuId)
    rows.push({
      skuId: a.skuId,
      name: mostCommonName,
      subHeader: mostCommonHeader === "__none__" ? null : mostCommonHeader,
      occurrences: a.occurrences,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      storeIds: Array.from(a.storeIds),
      mappedRecipeId: m?.recipeId ?? null,
      mappedRecipeName: m?.recipeName ?? null,
    })
  }

  rows.sort((a, b) => b.occurrences - a.occurrences)
  return rows
}

function pickTopKey(counts: Map<string, number>): string | null {
  let best: string | null = null
  let bestN = -1
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k
      bestN = n
    }
  }
  return best
}

export async function mapOtterSubItemToRecipe(input: {
  skuId: string
  otterSubItemName: string
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
      prisma.otterSubItemMapping.upsert({
        where: {
          storeId_skuId: { storeId: s.id, skuId: input.skuId },
        },
        create: {
          storeId: s.id,
          skuId: input.skuId,
          otterSubItemName: input.otterSubItemName,
          recipeId: input.recipeId,
        },
        update: {
          otterSubItemName: input.otterSubItemName,
          recipeId: input.recipeId,
          confirmedAt: new Date(),
        },
      })
    )
  )

  // Modifier recipe change ripples through every DailyCogsItem for the store —
  // safest to invalidate all days. The per-item scope doesn't fit here because
  // one modifier can affect many menu items.
  await Promise.all(
    stores.map((s) => invalidateDailyCogs({ kind: "store-full", storeId: s.id }))
  )
}

export async function unmapOtterSubItem(skuId: string): Promise<void> {
  const ownerId = await requireOwnerId()
  if (!ownerId) throw new Error("Not authenticated")

  const stores = await prisma.store.findMany({
    where: { ownerId },
    select: { id: true },
  })
  await prisma.otterSubItemMapping.deleteMany({
    where: {
      skuId,
      storeId: { in: stores.map((s) => s.id) },
    },
  })

  await Promise.all(
    stores.map((s) => invalidateDailyCogs({ kind: "store-full", storeId: s.id }))
  )
}

export type MenuItemSellPrice = {
  /** Blended average sell price across platforms over the lookback window. */
  avgPrice: number
  /** Total units sold over the lookback window — how much trust to put in the avg. */
  qtySold: number
}

/**
 * Per-Otter-item average selling price, aggregated from OtterMenuItem daily
 * rollups over the last N days (default 30). Lookup key is case-insensitive
 * item name.
 *
 * Falls back to the most recent OtterOrderItem.price for items that exist in
 * the order stream but don't have OtterMenuItem rollups (rare, but possible
 * for freshly added menu items).
 */
export async function getMenuItemSellPrices(
  lookbackDays: number = 30
): Promise<Map<string, MenuItemSellPrice>> {
  const ownerId = await requireOwnerId()
  if (!ownerId) return new Map()

  const stores = await prisma.store.findMany({
    where: { ownerId },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return new Map()

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays)

  // Primary: OtterMenuItem daily rollups — averaged total_sales / total_qty per item.
  const rollups = await prisma.otterMenuItem.findMany({
    where: {
      storeId: { in: storeIds },
      isModifier: false,
      date: { gte: cutoff },
    },
    select: {
      itemName: true,
      fpQuantitySold: true,
      tpQuantitySold: true,
      fpTotalSales: true,
      tpTotalSales: true,
    },
  })

  const agg = new Map<string, { qty: number; sales: number }>()
  for (const r of rollups) {
    const qty = (r.fpQuantitySold ?? 0) + (r.tpQuantitySold ?? 0)
    const sales = (r.fpTotalSales ?? 0) + (r.tpTotalSales ?? 0)
    if (qty <= 0) continue
    const key = r.itemName.toLowerCase()
    const existing = agg.get(key)
    if (existing) {
      existing.qty += qty
      existing.sales += sales
    } else {
      agg.set(key, { qty, sales })
    }
  }

  const prices = new Map<string, MenuItemSellPrice>()
  for (const [key, { qty, sales }] of agg) {
    if (qty <= 0 || sales <= 0) continue
    prices.set(key, { avgPrice: sales / qty, qtySold: qty })
  }

  // Fallback: items present in recent OtterOrderItem but missing rollups.
  // Group by lowercase name, take the most-recent-order price per name.
  const recentOrderItems = await prisma.otterOrderItem.findMany({
    where: {
      order: {
        storeId: { in: storeIds },
        referenceTimeLocal: { gte: cutoff },
      },
      price: { gt: 0 },
    },
    select: {
      name: true,
      price: true,
      quantity: true,
      order: { select: { referenceTimeLocal: true } },
    },
    orderBy: { order: { referenceTimeLocal: "desc" } },
    take: 5000,
  })

  for (const oi of recentOrderItems) {
    const key = oi.name.toLowerCase()
    if (prices.has(key)) continue
    const unit = oi.quantity > 0 ? oi.price / oi.quantity : oi.price
    prices.set(key, { avgPrice: unit, qtySold: Math.round(oi.quantity) })
  }

  return prices
}
