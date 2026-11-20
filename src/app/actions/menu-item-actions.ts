// Server-only, not a server action: nothing in the browser calls these, so
// they are plain functions and cannot be invoked from outside the server.
// Browser saves go through `src/lib/counter/actions/`.
import "server-only"
import { getAuthScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { getAccountStoreRows } from "@/lib/account-stores"
import { Prisma } from "@/generated/prisma/client"
import { revalidatePath } from "next/cache"
import type { OtterSubItemForCatalog as OtterSubItemForCatalogType } from "@/types/otter-subitem"
import {
  attachSubItemMappings,
  type SubItemAggregateRow,
} from "@/lib/otter-subitem-aggregation"

/**
 * A POS item mapped to (or off) a recipe moves the catalogue's mapped column
 * and margins, the recipes' sold counts, and the ingredient usage behind them.
 */
function revalidateMappingPages() {
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/recipes")
}

export async function mapOtterItemToRecipe(input: {
  otterItemName: string
  recipeId: string
}): Promise<void> {
  const scope = await getAuthScope()
  if (!scope) throw new Error("Not authenticated")
  const { ownerId, accountId } = scope

  // The one store query a request makes — `@/lib/account-stores`. This caller
  // counts inactive stores too, which is why the shared query does not filter.
  const stores = await getAccountStoreRows(accountId)
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
  revalidateMappingPages()
}

/**
 * Bulk-confirm a list of (POS item → recipe) mappings in one round trip.
 * Used by the "Confirm N high-confidence matches" topbar action on
 * /dashboard/recipes when ML's top suggestion is high-confidence (≥0.75).
 *
 * Mirrors `mapOtterItemToRecipe`: validates every recipe is in the caller's
 * account, then upserts an OtterItemMapping for every (store × pair). One
 * transaction so the operator either gets all-or-nothing — partial commits
 * would make the post-action P&L count untrustworthy.
 */
export async function mapOtterItemsBatch(
  pairs: { otterItemName: string; recipeId: string }[]
): Promise<{ mapped: number }> {
  const scope = await getAuthScope()
  if (!scope) throw new Error("Not authenticated")
  const { accountId } = scope

  if (pairs.length === 0) return { mapped: 0 }

  // The one store query a request makes — `@/lib/account-stores`. This caller
  // counts inactive stores too, which is why the shared query does not filter.
  const stores = await getAccountStoreRows(accountId)
  if (stores.length === 0) return { mapped: 0 }

  const recipeIds = Array.from(new Set(pairs.map((p) => p.recipeId)))
  const validRecipes = await prisma.recipe.findMany({
    where: { id: { in: recipeIds }, accountId },
    select: { id: true },
  })
  const validIds = new Set(validRecipes.map((r) => r.id))
  const filtered = pairs.filter((p) => validIds.has(p.recipeId))
  if (filtered.length === 0) return { mapped: 0 }

  await prisma.$transaction(
    filtered.flatMap((p) =>
      stores.map((s) =>
        prisma.otterItemMapping.upsert({
          where: {
            storeId_otterItemName: {
              storeId: s.id,
              otterItemName: p.otterItemName,
            },
          },
          create: {
            storeId: s.id,
            otterItemName: p.otterItemName,
            recipeId: p.recipeId,
          },
          update: { recipeId: p.recipeId, confirmedAt: new Date() },
        })
      )
    )
  )

  revalidateMappingPages()
  return { mapped: filtered.length }
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
  const scope = await getAuthScope()
  if (!scope) return []
  const { accountId } = scope

  // The one store query a request makes — `@/lib/account-stores`. This caller
  // counts inactive stores too, which is why the shared query does not filter.
  const stores = await getAccountStoreRows(accountId)
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
  const scope = await getAuthScope()
  if (!scope) throw new Error("Not authenticated")
  const { ownerId, accountId } = scope

  const stores = await getAccountStoreRows(accountId)
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
  revalidateMappingPages()
}

export async function unmapOtterSubItem(skuId: string): Promise<void> {
  const scope = await getAuthScope()
  if (!scope) throw new Error("Not authenticated")
  const { ownerId, accountId } = scope

  // The account boundary goes in the delete itself (`store: { accountId }`),
  // so the account's store ids are not read first just to be sent back.
  await prisma.otterSubItemMapping.deleteMany({
    where: { skuId, store: { accountId } },
  })

  revalidateMappingPages()
}
