import type { Prisma } from "@/generated/prisma/client"

/**
 * Which `DailyCogsItem` rows count as food cost (COGS). The one place that
 * decides it.
 *
 * The materializer writes two kinds of row: one per menu item (recipe cost,
 * engine A) and one per container group, `category: "Packaging"`,
 * `itemName: "Packaging - 9x6"` and so on — the takeaway boxes an order
 * needed, priced off the latest container invoice.
 *
 * **Packaging is out of food cost, for now.** The owner, 2026-11-03: "not
 * include packaging for now because it's changing and not a significant
 * percentage". The rows are still materialized — the Packaging page reads
 * them, and putting them back is flipping `PACKAGING_IN_FOOD_COST` — but every
 * figure labelled COGS / food cost (the P&L food line, Overview, prime cost,
 * the COGS page, Analytics, menu margins, the assistant's P&L) reads its rows
 * through `FOOD_COST_ROWS` or `isFoodCostRow`, so they leave packaging out
 * together. A reader that sums `lineCost` without one of them is a second
 * answer to "what was food cost", and the one that disagrees.
 *
 * Not applied to the theoretical-vs-purchased reconciliations (Product
 * usage, Inventory "used"): those weigh the cost walk against invoice spend,
 * and container invoices are in the spend.
 */
export const PACKAGING_CATEGORY = "Packaging"

/** Flip to put packaging back into food cost everywhere at once. */
export const PACKAGING_IN_FOOD_COST: boolean = false

/** Spread into a `dailyCogsItem` `where` that feeds a food-cost figure. */
export const FOOD_COST_ROWS: Prisma.DailyCogsItemWhereInput = PACKAGING_IN_FOOD_COST
  ? {}
  : { category: { not: PACKAGING_CATEGORY } }

/** The same rule for rows already in hand. */
export function isFoodCostRow(row: { category: string }): boolean {
  return PACKAGING_IN_FOOD_COST || row.category !== PACKAGING_CATEGORY
}
