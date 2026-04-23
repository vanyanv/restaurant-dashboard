import { listRecipes } from "@/app/actions/recipe-actions"
import {
  getMenuItemSellPrices,
  getMenuItemsForCatalog,
} from "@/app/actions/menu-item-actions"
import { resolveSellPriceForRecipe } from "@/lib/menu-sell-price"
import { MenuCatalogContent } from "../menu-catalog-content"

/**
 * Streams the catalog list for the Menu page.
 *
 * `getMenuItemsForCatalog()` returns Otter → recipe mappings which are
 * consumed only by `resolveSellPriceForRecipe` when a recipe's name does
 * not directly match a sold item. The mappings are not rendered as a
 * visible "unmapped items" panel — they feed sell-price resolution for
 * the rows below. For that reason both the row data and the mappings are
 * awaited here in parallel rather than split into separate Suspense
 * boundaries.
 */
export async function CatalogRowsSection() {
  const [recipes, sellPrices, otterMappings] = await Promise.all([
    listRecipes(),
    getMenuItemSellPrices(30),
    getMenuItemsForCatalog(),
  ])

  // Surface recipes the owner can actually sell; modifiers are plumbing.
  const menuRecipes = recipes.filter(
    (r) => r.isSellable && r.category !== "Modifier"
  )

  const rows = menuRecipes.map((r) => {
    const price = resolveSellPriceForRecipe(
      r.id,
      r.itemName,
      sellPrices,
      otterMappings
    )
    return {
      id: r.id,
      itemName: r.itemName,
      category: r.category,
      isConfirmed: r.isConfirmed,
      ingredientCount: r.ingredientCount,
      computedCost: r.computedCost,
      partialCost: r.partialCost,
      updatedAt: r.updatedAt,
      sellPrice: price?.avgPrice ?? null,
      qtySold: price?.qtySold ?? 0,
      sellSourceName: price?.sourceOtterName ?? null,
    }
  })

  return <MenuCatalogContent rows={rows} />
}
