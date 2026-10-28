import { prisma } from "@/lib/prisma"
import { sumAdjustments, type AdjustmentTotals } from "@/lib/counter/waste-reasons"

/**
 * Stock adjustments logged in a window, valued and grouped by reason class —
 * the figure Product usage and COGS print as "Waste logged".
 *
 * The grouping is `sumAdjustments` (`@/lib/counter/waste-reasons`), the same
 * one the count report sums its rows and its totals with, so "waste" means one
 * thing on every page. Valued at each ingredient's booked
 * `costPerRecipeUnit`, as the count report values it.
 *
 * Tenancy: `InventoryAdjustment` is store-owned, so the account boundary is
 * reached through `"Store"."accountId"`. `storeIds` null means every store on
 * the account.
 */
export async function loadLoggedAdjustments(input: {
  accountId: string
  storeIds: string[] | null
  from: Date
  to: Date
}): Promise<AdjustmentTotals> {
  const { accountId, storeIds, from, to } = input
  const rows = await prisma.$queryRaw<Array<{ reason: string; qty: number; cost: number | null }>>`
    SELECT a.reason::text AS reason, a.qty::float AS qty,
           ci."costPerRecipeUnit"::float AS cost
    FROM "InventoryAdjustment" a
    JOIN "Store" s ON s.id = a."storeId"
    JOIN "CanonicalIngredient" ci ON ci.id = a."canonicalIngredientId"
    WHERE s."accountId" = ${accountId}
      AND (${storeIds}::text[] IS NULL OR a."storeId" = ANY(${storeIds}::text[]))
      AND a."occurredAt" >= ${from} AND a."occurredAt" <= ${to}`
  return sumAdjustments(rows)
}
