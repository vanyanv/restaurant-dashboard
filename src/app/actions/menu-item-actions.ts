"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { revalidatePath } from "next/cache"
import type { MenuItemForCatalog } from "@/types/recipe"
import type { OtterSubItemForCatalog as OtterSubItemForCatalogType } from "@/types/otter-subitem"
import {
  attachSubItemMappings,
  type SubItemAggregateRow,
} from "@/lib/otter-subitem-aggregation"
import { mergeSellPrices } from "@/lib/menu-sell-price-aggregation"

async function requireOwnerId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id ?? null
}

async function requireScope(): Promise<{ ownerId: string; accountId: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return { ownerId: session.user.id, accountId: session.user.accountId }
}

/**
 * All distinct Otter-sold items across the owner's stores, with:
 *   - aggregate units sold over the window (default last 90 days)
 *   - first/last seen
 *   - whether it's already mapped to a Recipe (via OtterItemMapping or name match)
 *
 * Defaults to a 90-day window because the catalog surface is "items worth
 * mapping right now" — items that haven't sold in 90 days aren't actionable
 * and their rollup rows dominate the scan. Pass `sinceDays: null` to opt
 * into the full-history behaviour (reporting/backfill workflows).
 *
 * Sorted by total qty sold DESC so the most-impactful items surface first.
 */
export async function getMenuItemsForCatalog(
  options?: { sinceDays?: number | null }
): Promise<MenuItemForCatalog[]> {
  const scope = await requireScope()
  if (!scope) return []
  const { accountId } = scope

  const stores = await prisma.store.findMany({
    where: { accountId },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return []

  const sinceDays = options?.sinceDays === undefined ? 90 : options.sinceDays
  let dateFloor: Date | null = null
  if (sinceDays !== null) {
    dateFloor = new Date()
    dateFloor.setDate(dateFloor.getDate() - sinceDays)
  }

  const baseWhere = {
    storeId: { in: storeIds },
    isModifier: false,
    category: { not: "Uncategorized" },
    ...(dateFloor ? { date: { gte: dateFloor } } : {}),
  } as const

  const [aggRows, storeKeyRows] = await Promise.all([
    prisma.otterMenuItem.groupBy({
      by: ["itemName", "category"],
      where: baseWhere,
      _sum: { fpQuantitySold: true, tpQuantitySold: true },
      _min: { date: true },
      _max: { date: true },
    }),
    prisma.otterMenuItem.findMany({
      where: baseWhere,
      distinct: ["storeId", "itemName", "category"],
      select: { storeId: true, itemName: true, category: true },
    }),
  ])

  const storeIdsByKey = new Map<string, Set<string>>()
  for (const r of storeKeyRows) {
    const k = `${r.itemName}:::${r.category}`
    let set = storeIdsByKey.get(k)
    if (!set) {
      set = new Set()
      storeIdsByKey.set(k, set)
    }
    set.add(r.storeId)
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
    where: { accountId },
    select: { id: true, itemName: true },
  })
  const recipeByName = new Map(
    recipes.map((r) => [r.itemName.toLowerCase(), r])
  )

  const rows: MenuItemForCatalog[] = []
  for (const row of aggRows) {
    const { itemName, category } = row
    const totalQty =
      (row._sum.fpQuantitySold ?? 0) + (row._sum.tpQuantitySold ?? 0)
    const firstSeen = row._min.date
    const lastSeen = row._max.date
    if (!firstSeen || !lastSeen) continue
    const explicitMapping = mappingByItemName.get(itemName)
    const fallbackRecipe = explicitMapping
      ? null
      : recipeByName.get(itemName.toLowerCase()) ?? null
    rows.push({
      otterItemName: itemName,
      category,
      totalQtySoldAllTime: totalQty,
      firstSeen,
      lastSeen,
      mappedRecipeId:
        explicitMapping?.recipeId ?? fallbackRecipe?.id ?? null,
      mappedRecipeName:
        explicitMapping?.recipeName ?? fallbackRecipe?.itemName ?? null,
      storeIds: Array.from(
        storeIdsByKey.get(`${itemName}:::${category}`) ?? new Set<string>()
      ),
    })
  }

  rows.sort((a, b) => b.totalQtySoldAllTime - a.totalQtySoldAllTime)
  return rows
}

export async function mapOtterItemToRecipe(input: {
  otterItemName: string
  recipeId: string
}): Promise<void> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { ownerId, accountId } = scope

  const stores = await prisma.store.findMany({
    where: { accountId },
    select: { id: true },
  })
  const recipe = await prisma.recipe.findFirst({
    where: { id: input.recipeId, accountId },
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

  void stores
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/recipes")
}

export async function unmapOtterItem(otterItemName: string): Promise<void> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { ownerId, accountId } = scope

  const stores = await prisma.store.findMany({
    where: { accountId },
    select: { id: true },
  })
  await prisma.otterItemMapping.deleteMany({
    where: {
      otterItemName,
      storeId: { in: stores.map((s) => s.id) },
    },
  })

  void stores
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/recipes")
}

/* ─────────────────────────────── sub-items (modifiers) ─────────────────────────────── */

export type OtterSubItemForCatalog = OtterSubItemForCatalogType

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
 *
 * Defaults to a 90-day window on OtterOrder.referenceTimeLocal — the
 * underlying join grows by millions of rows per year and only recent
 * modifiers are actionable for mapping. Pass `sinceDays: null` to opt into
 * full-history behaviour.
 */
export async function getOtterSubItemsForCatalog(
  options?: { sinceDays?: number | null }
): Promise<OtterSubItemForCatalog[]> {
  const scope = await requireScope()
  if (!scope) return []
  const { accountId } = scope

  const stores = await prisma.store.findMany({
    where: { accountId },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return []

  const sinceDays = options?.sinceDays === undefined ? 90 : options.sinceDays
  let refTimeFloor: Date | null = null
  if (sinceDays !== null) {
    refTimeFloor = new Date()
    refTimeFloor.setDate(refTimeFloor.getDate() - sinceDays)
  }

  // DB-side aggregation: group by skuId in Postgres so we never materialize
  // the ~100k join rows in JS. Mirrors the contract validated by
  // `aggregateRawSubItemRows` in `src/lib/otter-subitem-aggregation.ts`.
  type RawAggregate = {
    skuId: string
    occurrences: string | number
    mostCommonName: string
    mostCommonHeader: string | null
    firstSeen: Date | null
    lastSeen: Date | null
    storeIds: string[]
  }
  const aggregates = await prisma.$queryRaw<RawAggregate[]>(Prisma.sql`
    WITH per_combo AS (
      SELECT
        s."skuId"        AS sku_id,
        s.name           AS name,
        s."subHeader"    AS sub_header,
        o."storeId"      AS store_id,
        SUM(COALESCE(s.quantity, 1) * COALESCE(i.quantity, 1)) AS uses,
        MIN(o."referenceTimeLocal") AS first_seen,
        MAX(o."referenceTimeLocal") AS last_seen
      FROM "OtterOrderSubItem" s
      JOIN "OtterOrderItem" i ON i.id = s."orderItemId"
      JOIN "OtterOrder" o     ON o.id = i."orderId"
      WHERE o."storeId" = ANY(${storeIds}::text[])
        AND s."skuId" IS NOT NULL
        AND (
          ${refTimeFloor}::timestamp IS NULL
          OR o."referenceTimeLocal" >= ${refTimeFloor}::timestamp
        )
      GROUP BY 1, 2, 3, 4
    ),
    name_votes AS (
      SELECT sku_id, name, SUM(uses) AS uses
      FROM per_combo GROUP BY 1, 2
    ),
    header_votes AS (
      SELECT sku_id, sub_header, SUM(uses) AS uses
      FROM per_combo GROUP BY 1, 2
    ),
    top_name AS (
      SELECT DISTINCT ON (sku_id) sku_id, name
      FROM name_votes
      ORDER BY sku_id, uses DESC, name
    ),
    top_header AS (
      SELECT DISTINCT ON (sku_id) sku_id, sub_header
      FROM header_votes
      ORDER BY sku_id, uses DESC, sub_header NULLS LAST
    ),
    totals AS (
      SELECT
        sku_id,
        SUM(uses)                       AS occurrences,
        MIN(first_seen)                 AS first_seen,
        MAX(last_seen)                  AS last_seen,
        array_agg(DISTINCT store_id)    AS store_ids
      FROM per_combo
      GROUP BY 1
    )
    SELECT
      t.sku_id        AS "skuId",
      t.occurrences   AS "occurrences",
      tn.name         AS "mostCommonName",
      th.sub_header   AS "mostCommonHeader",
      t.first_seen    AS "firstSeen",
      t.last_seen     AS "lastSeen",
      t.store_ids     AS "storeIds"
    FROM totals t
    JOIN top_name   tn ON tn.sku_id = t.sku_id
    JOIN top_header th ON th.sku_id = t.sku_id
    ORDER BY t.occurrences DESC
  `)

  const aggregateRows: SubItemAggregateRow[] = aggregates.map((a) => ({
    skuId: a.skuId,
    occurrences: Number(a.occurrences),
    mostCommonName: a.mostCommonName ?? "",
    mostCommonHeader: a.mostCommonHeader,
    firstSeen: a.firstSeen,
    lastSeen: a.lastSeen,
    storeIds: a.storeIds,
  }))

  const mappings = await prisma.otterSubItemMapping.findMany({
    where: { storeId: { in: storeIds } },
    include: { recipe: { select: { id: true, itemName: true } } },
  })
  return attachSubItemMappings(
    aggregateRows,
    mappings.map((m) => ({
      skuId: m.skuId,
      recipeId: m.recipeId,
      recipeName: m.recipe.itemName,
    }))
  )
}

export async function mapOtterSubItemToRecipe(input: {
  skuId: string
  otterSubItemName: string
  recipeId: string
}): Promise<void> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { ownerId, accountId } = scope

  const stores = await prisma.store.findMany({
    where: { accountId },
    select: { id: true },
  })
  const recipe = await prisma.recipe.findFirst({
    where: { id: input.recipeId, accountId },
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

  void stores
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/recipes")
}

export async function unmapOtterSubItem(skuId: string): Promise<void> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { ownerId, accountId } = scope

  const stores = await prisma.store.findMany({
    where: { accountId },
    select: { id: true },
  })
  await prisma.otterSubItemMapping.deleteMany({
    where: {
      skuId,
      storeId: { in: stores.map((s) => s.id) },
    },
  })

  void stores
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/recipes")
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
  const scope = await requireScope()
  if (!scope) return new Map()
  const { accountId } = scope

  const stores = await prisma.store.findMany({
    where: { accountId },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return new Map()

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays)

  const [primaryRows, fallbackRows] = await Promise.all([
    prisma.otterMenuItem.groupBy({
      by: ["itemName"],
      where: {
        storeId: { in: storeIds },
        isModifier: false,
        date: { gte: cutoff },
      },
      _sum: {
        fpQuantitySold: true,
        tpQuantitySold: true,
        fpTotalSales: true,
        tpTotalSales: true,
      },
    }),
    prisma.$queryRaw<
      Array<{ name: string; price: number; quantity: number }>
    >(Prisma.sql`
      SELECT DISTINCT ON (LOWER(oi."name"))
        oi."name", oi."price"::float AS "price", oi."quantity"::float AS "quantity"
      FROM "OtterOrderItem" oi
      JOIN "OtterOrder" oo ON oo."id" = oi."orderId"
      WHERE oo."storeId" = ANY(${storeIds}::text[])
        AND oo."referenceTimeLocal" >= ${cutoff}
        AND oi."price" > 0
      ORDER BY LOWER(oi."name"), oo."referenceTimeLocal" DESC
    `),
  ])

  const merged = mergeSellPrices(
    primaryRows.map((r) => ({
      itemName: r.itemName,
      totalQty: (r._sum.fpQuantitySold ?? 0) + (r._sum.tpQuantitySold ?? 0),
      totalSales: (r._sum.fpTotalSales ?? 0) + (r._sum.tpTotalSales ?? 0),
    })),
    fallbackRows
  )

  return merged
}
